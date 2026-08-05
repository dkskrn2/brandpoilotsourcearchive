import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { resolveVerifiedTlsConfig } from "./databaseTls.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultMigrationDirectory = path.resolve(scriptDirectory, "../db/migrations");

const compatibleMigrationChecksums = Object.freeze({
  "014_instagram_delivery_formats.sql": Object.freeze({
    "7e45bc297cf35128368700b49f34974690d699198e465ecfb608ac9922cb1882":
      "db4ef9edcccd8f882ade789b1a2b0bc595c7f5c101fb3c9337b02576928e4a05",
  }),
});
const migrationAdvisoryLockName = "brand-pilot:schema-migrations:v1";
const bootstrap074MigrationId = "074_ai_content_maintenance_write_fence.sql";
const providerAttestationContract = "ai-content-074-provider-attestation.v3";
// An empty tag catalog is intentional: the provider event trigger observes every
// ddl_command_end command and the security-definer guard applies the exact DB
// allowlist. A WHEN TAG filter would leave unlisted DDL as an unguarded bypass.
export const required074DdlGuardTags = Object.freeze([]);
export const bootstrapFenceRelations = Object.freeze([
  "ai_content_analyzed_subject_snapshots", "ai_content_approved_proposal_versions",
  "ai_content_attachment_deletion_jobs", "ai_content_attachment_storage_path_guards",
  "ai_content_attachment_upload_sessions", "ai_content_create_idempotency_records",
  "ai_content_generation_attachments", "ai_content_generation_briefs",
  "ai_content_generation_input_snapshots", "ai_content_generation_jobs",
  "ai_content_generation_outputs", "ai_content_generation_reference_migration_audits",
  "ai_content_generation_references", "ai_content_generation_render_jobs",
  "ai_content_generations", "ai_content_one_time_avatar_receipts",
  "ai_content_one_time_avatar_revocations", "ai_content_output_research_snapshots",
  "ai_content_proposal_batches", "ai_content_proposal_jobs",
  "ai_content_proposal_research_snapshots", "ai_content_proposals",
  "ai_content_subject_analyses", "ai_content_subject_appeal_regeneration_keys",
  "ai_content_subject_images", "ai_content_usage_ledger", "ai_content_wiki_version_snapshots",
  "auto_approval_checks", "automation_runs", "brand_format_rotation_states", "channel_outputs", "content_topics",
  "jobs", "llm_runs", "master_drafts", "publish_attempts", "publish_queue", "regeneration_requests",
  "review_events", "source_crawl_runs", "storage_artifacts", "topic_publish_groups", "topic_rows",
]);
const bootstrapSharedClassifiers = Object.freeze({
  automation_runs: "daily_generation_automation",
  jobs: "legacy_content_job",
  publish_queue: "ai_content_scheduled_publish",
  publish_attempts: "ai_content_publish_attempt",
  source_crawl_runs: "scheduled_proposal_refresh",
  storage_artifacts: "ai_content_generated_artifact",
  topic_rows: "legacy_automated_topic",
});
export const bootstrapFenceCatalog = Object.freeze([
  ...bootstrapFenceRelations.map((relation_name) => ({
    relation_name,
    relation_class: "customer_execution",
    row_classifier: bootstrapSharedClassifiers[relation_name] ?? "whole_relation",
  })),
  ...["ai_content_bootstrap_state", "ai_content_cutover_status_events", "ai_content_cutovers",
    "ai_content_ddl_allowlist", "ai_content_maintenance_state", "ai_content_write_fence_catalog"]
    .map((relation_name) => ({ relation_name, relation_class: "cutover_control", row_classifier: "whole_relation" })),
].sort((left, right) => left.relation_name < right.relation_name ? -1 : left.relation_name > right.relation_name ? 1 : 0));

const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function assertExactObjectKeys(value, keys, errorCode) {
  const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)
    || JSON.stringify(Object.keys(value).sort(lexicalCompare)) !== JSON.stringify([...keys].sort(lexicalCompare))) {
    throw new Error(errorCode);
  }
}

export function canonicalBootstrapRoleCatalog({ roles: roleRows, membershipEdges: edgeRows }) {
  const roles = roleRows.map((row) => ({
    roleName: String(row.role_name),
    canLogin: row.can_login === true,
    isSuperuser: row.is_superuser === true,
    bypassRls: row.bypass_rls === true,
    canCreateDatabase: row.can_create_db === true,
    canCreateRole: row.can_create_role === true,
    canReplicate: row.can_replicate === true,
    inherit: row.inherit === true,
  })).sort((left, right) => lexicalCompare(left.roleName, right.roleName));
  const membershipEdges = edgeRows.map((row) => ({
    memberRoleName: String(row.member_role_name),
    parentRoleName: String(row.parent_role_name),
    setOption: row.set_option === true,
    inheritOption: row.inherit_option === true,
    adminOption: row.admin_option === true,
  })).sort((left, right) => lexicalCompare(
    `${left.memberRoleName}\0${left.parentRoleName}`,
    `${right.memberRoleName}\0${right.parentRoleName}`,
  ));
  return JSON.stringify({ contractVersion: "ai-content-bootstrap-role-catalog.v3", roles, membershipEdges });
}

export function hashBootstrapRoleCatalog(catalog) {
  return checksum(canonicalBootstrapRoleCatalog(catalog));
}

export function canonicalBootstrapObjectCatalog(rows) {
  const objects = rows.map((row) => ({
    schemaName: String(row.schema_name),
    relationName: String(row.relation_name),
    relationKind: String(row.relation_kind),
    ownerRoleName: String(row.owner_role_name),
    columns: [...(row.columns ?? [])].map((column) => ({
      ordinalPosition: Number(column.ordinal_position),
      columnName: String(column.column_name),
      typeIdentity: String(column.type_identity),
      notNull: column.not_null === true,
    })).sort((left, right) => left.ordinalPosition-right.ordinalPosition || lexicalCompare(left.columnName, right.columnName)),
  })).sort((left, right) => lexicalCompare(`${left.schemaName}.${left.relationName}`, `${right.schemaName}.${right.relationName}`));
  return JSON.stringify({ contractVersion: "ai-content-bootstrap-object-catalog.v1", objects });
}

export function hashBootstrapObjectCatalog(rows) {
  return checksum(canonicalBootstrapObjectCatalog(rows));
}

export function validateBootstrapRoleSafety({ roles: rows, membershipEdges }, names) {
  if (!Array.isArray(rows) || !Array.isArray(membershipEdges)) throw new Error("bootstrap_role_catalog_invalid");
  const byName = new Map(rows.map((row) => [String(row.role_name), row]));
  const exactNames = [names.schemaOwnerRoleName, names.applicationRoleName, names.operatorRoleName,
    names.migrationRoleName, names.cleanupRoleName];
  if (rows.length !== 5 || byName.size !== 5 || exactNames.some((name) => !byName.has(name))) throw new Error("bootstrap_role_catalog_invalid");
  const booleanRoleFields = ["can_login", "is_superuser", "bypass_rls", "can_create_db", "can_create_role", "can_replicate", "inherit"];
  if (rows.some((row) => booleanRoleFields.some((field) => typeof row[field] !== "boolean")
    || row.is_superuser || row.bypass_rls || row.can_create_db || row.can_create_role || row.can_replicate)) {
    throw new Error("bootstrap_role_catalog_invalid");
  }
  if (byName.get(names.schemaOwnerRoleName).can_login !== false
    || byName.get(names.applicationRoleName).can_login !== true
    || byName.get(names.operatorRoleName).can_login !== true
    || byName.get(names.migrationRoleName).can_login !== true
    || byName.get(names.cleanupRoleName).can_login !== true
    || byName.get(names.migrationRoleName).inherit !== false) {
    throw new Error("bootstrap_role_catalog_invalid");
  }
  const expectedMembershipEdges = [{
    member_role_name: names.migrationRoleName,
    parent_role_name: names.schemaOwnerRoleName,
    set_option: true,
    inherit_option: false,
    admin_option: false,
  }];
  const normalizeEdge = (row) => ({
    member_role_name: String(row.member_role_name), parent_role_name: String(row.parent_role_name),
    set_option: row.set_option === true, inherit_option: row.inherit_option === true,
    admin_option: row.admin_option === true,
  });
  const edges = membershipEdges.map(normalizeEdge).sort((left, right) => lexicalCompare(
    `${left.member_role_name}\0${left.parent_role_name}`,
    `${right.member_role_name}\0${right.parent_role_name}`,
  ));
  if (JSON.stringify(edges) !== JSON.stringify(expectedMembershipEdges)) throw new Error("bootstrap_role_catalog_invalid");
  return true;
}

export function canonicalEventTriggerDefinition(value) {
  return JSON.stringify({
    contractVersion: "ai-content-074-event-trigger-definition.v1",
    eventTriggerName: value.eventTriggerName,
    eventTriggerEvent: value.eventTriggerEvent,
    eventTriggerEnabled: value.eventTriggerEnabled,
    eventTriggerFunction: value.eventTriggerFunction,
    eventTriggerFunctionSha256: value.eventTriggerFunctionSha256,
    eventTriggerOwner: value.eventTriggerOwner,
    eventTriggerTags: [...(value.eventTriggerTags ?? [])].map(String).sort(lexicalCompare),
  });
}

export function hashEventTriggerDefinition(value) {
  return checksum(canonicalEventTriggerDefinition(value));
}

const normalizeAcl = (rows = []) => rows.map((row) => ({
  grantee: String(row.grantee),
  privilege: String(row.privilege).toUpperCase(),
  grantable: row.grantable === true,
})).sort((left, right) => lexicalCompare(`${left.grantee}|${left.privilege}|${left.grantable}`, `${right.grantee}|${right.privilege}|${right.grantable}`));

export function canonicalFenceSecurityCatalog(value) {
  const functions = [...(value.functions ?? [])].map((row) => ({
    identity: String(row.identity),
    definitionSha256: String(row.definition_sha256 ?? row.definitionSha256),
    ownerRoleName: String(row.owner_role_name ?? row.ownerRoleName),
    securityDefiner: (row.security_definer ?? row.securityDefiner) === true,
    config: [...(row.config ?? [])].map((item) => String(item).replace(/\s+/g, "")).sort(lexicalCompare),
    acl: normalizeAcl(row.acl),
  })).sort((left, right) => lexicalCompare(left.identity, right.identity));
  const ordinaryTriggers = [...(value.ordinaryTriggers ?? [])].map((row) => ({
    relationName: String(row.relation_name ?? row.relationName),
    triggerName: String(row.trigger_name ?? row.triggerName),
    triggerType: Number(row.trigger_type ?? row.triggerType),
    functionIdentity: String(row.function_identity ?? row.functionIdentity),
    enabled: String(row.enabled),
  })).sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  const fenceCatalog = [...(value.fenceCatalog ?? [])].map((row) => ({
    relationName: String(row.relation_name ?? row.relationName),
    relationClass: String(row.relation_class ?? row.relationClass),
    rowClassifier: String(row.row_classifier ?? row.rowClassifier),
  })).sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  const controlRelations = [...(value.controlRelations ?? [])].map((row) => ({
    relationName: String(row.relation_name ?? row.relationName),
    ownerRoleName: String(row.owner_role_name ?? row.ownerRoleName),
    acl: normalizeAcl(row.acl),
  })).sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  return JSON.stringify({ contractVersion: "ai-content-074-fence-security-catalog.v1", functions, ordinaryTriggers, fenceCatalog, controlRelations });
}

export function hashFenceSecurityCatalog(value) {
  return checksum(canonicalFenceSecurityCatalog(value));
}

const fenceSecurityCatalogKeys = Object.freeze(["contractVersion", "functions", "ordinaryTriggers", "fenceCatalog", "controlRelations"]);
const fenceSecurityFunctionKeys = Object.freeze(["identity", "definitionSha256", "ownerRoleName", "securityDefiner", "config", "acl"]);
const fenceSecurityTriggerKeys = Object.freeze(["relationName", "triggerName", "triggerType", "functionIdentity", "enabled"]);
const fenceSecurityFenceKeys = Object.freeze(["relationName", "relationClass", "rowClassifier"]);
const fenceSecurityControlKeys = Object.freeze(["relationName", "ownerRoleName", "acl"]);
const aclKeys = Object.freeze(["grantee", "privilege", "grantable"]);

function validateStoredFenceSecurityCatalog(value, expectedSha256, errorCode = "bootstrap_074_fence_security_catalog_mismatch") {
  assertExactObjectKeys(value, fenceSecurityCatalogKeys, errorCode);
  if (value.contractVersion !== "ai-content-074-fence-security-catalog.v1"
    || !Array.isArray(value.functions) || !Array.isArray(value.ordinaryTriggers)
    || !Array.isArray(value.fenceCatalog) || !Array.isArray(value.controlRelations)) throw new Error(errorCode);
  for (const row of value.functions) {
    assertExactObjectKeys(row, fenceSecurityFunctionKeys, errorCode);
    if (!Array.isArray(row.config) || !Array.isArray(row.acl)) throw new Error(errorCode);
    row.acl.forEach((acl) => assertExactObjectKeys(acl, aclKeys, errorCode));
  }
  for (const row of value.ordinaryTriggers) assertExactObjectKeys(row, fenceSecurityTriggerKeys, errorCode);
  for (const row of value.fenceCatalog) assertExactObjectKeys(row, fenceSecurityFenceKeys, errorCode);
  for (const row of value.controlRelations) {
    assertExactObjectKeys(row, fenceSecurityControlKeys, errorCode);
    if (!Array.isArray(row.acl)) throw new Error(errorCode);
    row.acl.forEach((acl) => assertExactObjectKeys(acl, aclKeys, errorCode));
  }
  const canonicalJson = canonicalFenceSecurityCatalog(value);
  const projectAcl = (acl) => acl.map((item) => Object.fromEntries(aclKeys.map((key) => [key, item[key]])));
  const exactProjection = {
    contractVersion: value.contractVersion,
    functions: value.functions.map((row) => ({ ...Object.fromEntries(fenceSecurityFunctionKeys.map((key) => [key, row[key]])), acl: projectAcl(row.acl) })),
    ordinaryTriggers: value.ordinaryTriggers.map((row) => Object.fromEntries(fenceSecurityTriggerKeys.map((key) => [key, row[key]]))),
    fenceCatalog: value.fenceCatalog.map((row) => Object.fromEntries(fenceSecurityFenceKeys.map((key) => [key, row[key]]))),
    controlRelations: value.controlRelations.map((row) => ({ ...Object.fromEntries(fenceSecurityControlKeys.map((key) => [key, row[key]])), acl: projectAcl(row.acl) })),
  };
  if (canonicalJson !== JSON.stringify(exactProjection) || !exactHex(expectedSha256, 64) || checksum(canonicalJson) !== expectedSha256) {
    throw new Error(errorCode);
  }
  return canonicalJson;
}

function deriveExpectedFinalFenceSecurityCatalog(interimCanonicalJson, schemaOwnerRoleName) {
  const interim = JSON.parse(interimCanonicalJson);
  if (JSON.stringify(interim.functions.map((row) => row.identity)) !== JSON.stringify(providerEnforcementBundle.functions)
    || JSON.stringify(interim.controlRelations.map((row) => row.relationName)) !== JSON.stringify(providerEnforcementBundle.controlRelations)) {
    throw new Error("bootstrap_074_provider_bundle_manifest_mismatch");
  }
  const replaceOwnerAcl = (acl) => acl.map((item) => item.grantee === schemaOwnerRoleName
    ? { ...item, grantee: "postgres" }
    : item);
  const finalCatalog = {
    ...interim,
    functions: interim.functions.map((row) => ({ ...row, ownerRoleName: "postgres", acl: replaceOwnerAcl(row.acl) })),
    controlRelations: interim.controlRelations.map((row) => ({ ...row, ownerRoleName: "postgres", acl: replaceOwnerAcl(row.acl) })),
  };
  const canonicalJson = canonicalFenceSecurityCatalog(finalCatalog);
  return { canonicalJson, catalogSha256: checksum(canonicalJson), catalog: JSON.parse(canonicalJson) };
}

export function canonicalEventTriggerCatalog(rows) {
  const eventTriggers = rows.map((row) => ({
    eventTriggerName: String(row.event_trigger_name ?? row.eventTriggerName),
    eventTriggerEvent: String(row.event_trigger_event ?? row.eventTriggerEvent),
    eventTriggerTags: [...(row.event_trigger_tags ?? row.eventTriggerTags ?? [])].map(String).sort(lexicalCompare),
    eventTriggerEnabled: String(row.event_trigger_enabled ?? row.eventTriggerEnabled),
    eventTriggerOwner: String(row.event_trigger_owner ?? row.eventTriggerOwner),
    eventTriggerFunction: String(row.event_trigger_function ?? row.eventTriggerFunction),
    eventTriggerFunctionSha256: String(row.event_trigger_function_sha256 ?? row.eventTriggerFunctionSha256),
  })).sort((left, right) => lexicalCompare(left.eventTriggerName, right.eventTriggerName));
  return JSON.stringify({ contractVersion: "ai-content-event-trigger-catalog.v1", eventTriggers });
}

const eventTriggerCatalogEnvelopeKeys = Object.freeze(["contractVersion", "eventTriggers"]);
const eventTriggerCatalogRowKeys = Object.freeze(["eventTriggerName", "eventTriggerEvent", "eventTriggerTags",
  "eventTriggerEnabled", "eventTriggerOwner", "eventTriggerFunction", "eventTriggerFunctionSha256"]);

function validateStoredEventTriggerCatalogEnvelope(value, expectedSha256, expectedCount) {
  const errorCode = "bootstrap_074_event_trigger_baseline_invalid";
  assertExactObjectKeys(value, eventTriggerCatalogEnvelopeKeys, errorCode);
  if (value.contractVersion !== "ai-content-event-trigger-catalog.v1" || !Array.isArray(value.eventTriggers)) {
    throw new Error(errorCode);
  }
  for (const row of value.eventTriggers) {
    assertExactObjectKeys(row, eventTriggerCatalogRowKeys, errorCode);
    if (!Array.isArray(row.eventTriggerTags)) throw new Error(errorCode);
  }
  const canonicalJson = canonicalEventTriggerCatalog(value.eventTriggers);
  const canonical = JSON.parse(canonicalJson);
  const exactRows = value.eventTriggers.map((row) => Object.fromEntries(eventTriggerCatalogRowKeys.map((key) => [key, row[key]])));
  if (JSON.stringify(exactRows) !== JSON.stringify(canonical.eventTriggers)
    || value.eventTriggers.length !== expectedCount
    || !exactHex(expectedSha256, 64)
    || checksum(canonicalJson) !== expectedSha256) {
    throw new Error(errorCode);
  }
  return canonicalJson;
}

export function hashEventTriggerCatalog(rows) {
  return checksum(canonicalEventTriggerCatalog(rows));
}

export async function readCanonicalEventTriggerCatalog(client) {
  const result = await client.query(
    `/* full_event_trigger_catalog_v1 */
     select event_trigger.evtname as event_trigger_name,event_trigger.evtevent as event_trigger_event,
            coalesce(event_trigger.evttags,'{}'::text[]) as event_trigger_tags,
            case event_trigger.evtenabled when 'O' then 'enabled' else event_trigger.evtenabled::text end as event_trigger_enabled,
            owner.rolname as event_trigger_owner,
            namespace.nspname || '.' || function.proname as event_trigger_function,
            encode(digest(pg_get_functiondef(function.oid),'sha256'),'hex') as event_trigger_function_sha256
       from pg_event_trigger event_trigger
       join pg_roles owner on owner.oid=event_trigger.evtowner
       join pg_proc function on function.oid=event_trigger.evtfoid
       join pg_namespace namespace on namespace.oid=function.pronamespace
      order by event_trigger.evtname`,
  );
  return {
    rows: result.rows,
    count: result.rows.length,
    catalogSha256: hashEventTriggerCatalog(result.rows),
    canonicalJson: canonicalEventTriggerCatalog(result.rows),
  };
}

export function validateEventTriggerCatalogDelta(beforeCanonicalJson, afterRows, authorization) {
  let before;
  try { before = JSON.parse(beforeCanonicalJson); } catch { throw new Error("bootstrap_074_event_trigger_baseline_invalid"); }
  const after = JSON.parse(canonicalEventTriggerCatalog(afterRows));
  if (before?.contractVersion !== "ai-content-event-trigger-catalog.v1" || !Array.isArray(before.eventTriggers)
    || after.eventTriggers.length !== before.eventTriggers.length + 1) {
    throw new Error("bootstrap_074_event_trigger_delta_invalid");
  }
  const beforeByName = new Map(before.eventTriggers.map((row) => [row.eventTriggerName, row]));
  for (const row of after.eventTriggers) {
    if (beforeByName.has(row.eventTriggerName)
      && exactJson(beforeByName.get(row.eventTriggerName)) !== exactJson(row)) {
      throw new Error("bootstrap_074_event_trigger_delta_invalid");
    }
  }
  const added = after.eventTriggers.filter((row) => !beforeByName.has(row.eventTriggerName));
  if (added.length !== 1) throw new Error("bootstrap_074_event_trigger_delta_invalid");
  const expected = JSON.parse(canonicalEventTriggerCatalog([{
    event_trigger_name: authorization.eventTriggerName,
    event_trigger_event: authorization.eventTriggerEvent,
    event_trigger_tags: authorization.eventTriggerTags,
    event_trigger_enabled: "enabled",
    event_trigger_owner: authorization.eventTriggerOwner,
    event_trigger_function: authorization.eventTriggerFunction,
    event_trigger_function_sha256: authorization.eventTriggerFunctionSha256,
  }])).eventTriggers[0];
  if (exactJson(added[0]) !== exactJson(expected)) throw new Error("bootstrap_074_event_trigger_delta_invalid");
  return { catalogSha256: hashEventTriggerCatalog(afterRows), count: after.eventTriggers.length };
}

const fenceSecurityFunctions = Object.freeze([
  { identity: "public.ai_content_cutover_bypass_allowed()", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration" },
  { identity: "public.ai_content_fence_trigger_name(text)", securityDefiner: false, config: ["search_path=pg_catalog"] },
  { identity: "public.assert_ai_content_writable()", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "application" },
  { identity: "public.consume_ai_content_provider_attestation()", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration" },
  { identity: "public.enforce_ai_content_ddl_allowlist()", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.enforce_ai_content_write_fence()", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.forbid_ai_content_cutover_event_mutation()", securityDefiner: false, config: ["search_path=pg_catalog,public"] },
  { identity: "public.prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamp with time zone,text,text,text,text,text)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "operator" },
  { identity: "public.set_ai_content_maintenance(uuid,boolean)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "operator" },
  { identity: "public.transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamp with time zone,text)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "operator" },
  { identity: "public.verify_ai_content_write_fence_catalog()", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration" },
]);
const fenceControlRelations = Object.freeze([
  "ai_content_bootstrap_state", "ai_content_cutover_status_events", "ai_content_cutovers",
  "ai_content_ddl_allowlist", "ai_content_maintenance_state", "ai_content_write_fence_catalog",
]);
export const providerEnforcementBundle = Object.freeze({
  contractVersion: "ai-content-074-provider-enforcement-bundle.v1",
  ownerRoleName: "postgres",
  functions: fenceSecurityFunctions.map(({ identity }) => identity).sort(lexicalCompare),
  controlRelations: [...fenceControlRelations].sort(lexicalCompare),
});
export const providerEnforcementBundleSha256 = checksum(JSON.stringify(providerEnforcementBundle));
const tableOwnerPrivileges = Object.freeze(["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]);

function expectedAcl(owner, extra = []) {
  return normalizeAcl([{ grantee: owner, privilege: "EXECUTE", grantable: false }, ...extra]);
}

function exactJson(value) {
  return JSON.stringify(value);
}

export async function readFenceSecurityCatalog(client, names, { ownerRoleName = names.schemaOwnerRoleName } = {}) {
  const functionResult = await client.query(
    `/* fence_security_functions_v1 */
     select requested.identity,
            encode(digest(pg_get_functiondef(function.oid),'sha256'),'hex') as definition_sha256,
            owner.rolname as owner_role_name,function.prosecdef as security_definer,
            coalesce(function.proconfig,'{}'::text[]) as config,
            coalesce((select jsonb_agg(jsonb_build_object(
              'grantee',case acl.grantee when 0 then 'PUBLIC' else grantee.rolname end,
              'privilege',acl.privilege_type,'grantable',acl.is_grantable
            ) order by case acl.grantee when 0 then 'PUBLIC' else grantee.rolname end,acl.privilege_type)
              from aclexplode(coalesce(function.proacl,acldefault('f',function.proowner))) acl
              left join pg_roles grantee on grantee.oid=acl.grantee),'[]'::jsonb) as acl
       from unnest($1::text[]) requested(identity)
       join pg_proc function on function.oid=to_regprocedure(requested.identity)
       join pg_roles owner on owner.oid=function.proowner
      order by requested.identity`,
    [fenceSecurityFunctions.map((item) => item.identity)],
  );
  if (functionResult.rows.length !== fenceSecurityFunctions.length) throw new Error("bootstrap_074_fence_security_function_missing");
  const functionByIdentity = new Map(functionResult.rows.map((row) => [String(row.identity), row]));
  const roleByKey = { application: names.applicationRoleName, operator: names.operatorRoleName, migration: names.migrationRoleName };
  for (const expected of fenceSecurityFunctions) {
    const actual = functionByIdentity.get(expected.identity);
    const extras = expected.execute ? [{ grantee: roleByKey[expected.execute], privilege: "EXECUTE", grantable: false }] : [];
    if (!actual || actual.owner_role_name !== ownerRoleName
      || actual.security_definer !== expected.securityDefiner
      || exactJson([...(actual.config ?? [])].map((item) => String(item).replace(/\s+/g, "")).sort(lexicalCompare)) !== exactJson(expected.config)
      || exactJson(normalizeAcl(actual.acl)) !== exactJson(expectedAcl(ownerRoleName, extras))) {
      throw new Error(`bootstrap_074_fence_security_function_mismatch:${expected.identity}:${JSON.stringify({ owner: actual?.owner_role_name, securityDefiner: actual?.security_definer, config: actual?.config, acl: normalizeAcl(actual?.acl) })}`);
    }
  }
  const triggerResult = await client.query(
    `/* fence_security_ordinary_triggers_v1 */
     select relation.relname as relation_name,trigger.tgname as trigger_name,
            trigger.tgtype::integer as trigger_type,trigger.tgenabled as enabled,
            namespace.nspname || '.' || function.proname || '(' || pg_get_function_identity_arguments(function.oid) || ')' as function_identity
       from pg_trigger trigger
       join pg_class relation on relation.oid=trigger.tgrelid
       join pg_namespace relation_namespace on relation_namespace.oid=relation.relnamespace and relation_namespace.nspname='public'
       join pg_proc function on function.oid=trigger.tgfoid
       join pg_namespace namespace on namespace.oid=function.pronamespace
      where not trigger.tgisinternal and trigger.tgfoid='public.enforce_ai_content_write_fence()'::regprocedure
      order by relation.relname`,
  );
  if (triggerResult.rows.length !== bootstrapFenceRelations.length) throw new Error("bootstrap_074_fence_security_trigger_mismatch");
  for (const row of triggerResult.rows) {
    const expectedName = `ai_content_fence_${String(row.relation_name).slice(0, 30)}_${createHash("md5").update(String(row.relation_name)).digest("hex").slice(0, 12)}`;
    if (!bootstrapFenceRelations.includes(String(row.relation_name)) || row.trigger_name !== expectedName
      || Number(row.trigger_type) !== 31 || row.enabled !== "A"
      || row.function_identity !== "public.enforce_ai_content_write_fence()") {
      throw new Error("bootstrap_074_fence_security_trigger_mismatch");
    }
  }
  const catalogResult = await client.query(
    `/* fence_security_catalog_rows_v1 */
     select relation_name,relation_class,row_classifier
       from ai_content_write_fence_catalog order by relation_name`,
  );
  const catalogText = catalogResult.rows.map((row) => `${row.relation_name}|${row.relation_class}|${row.row_classifier}`).join("\n");
  if (catalogResult.rows.length !== 49 || checksum(catalogText) !== "82b7d45786d6fd94d6b3d2487dc2456c762e5da5430db79b870d4d2dc0284f2f") {
    throw new Error("bootstrap_074_fence_security_catalog_mismatch");
  }
  const controlResult = await client.query(
    `/* fence_security_control_relations_v1 */
     select requested.relation_name,owner.rolname as owner_role_name,
            coalesce((select jsonb_agg(jsonb_build_object(
              'grantee',case acl.grantee when 0 then 'PUBLIC' else grantee.rolname end,
              'privilege',acl.privilege_type,'grantable',acl.is_grantable
            ) order by case acl.grantee when 0 then 'PUBLIC' else grantee.rolname end,acl.privilege_type)
              from aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
              left join pg_roles grantee on grantee.oid=acl.grantee),'[]'::jsonb) as acl
       from unnest($1::text[]) requested(relation_name)
       join pg_class relation on relation.oid=to_regclass('public.' || requested.relation_name)
       join pg_roles owner on owner.oid=relation.relowner
      order by requested.relation_name`,
    [fenceControlRelations],
  );
  if (controlResult.rows.length !== fenceControlRelations.length) throw new Error("bootstrap_074_fence_security_control_mismatch");
  for (const row of controlResult.rows) {
    const extra = row.relation_name === "ai_content_maintenance_state"
      ? [{ grantee: names.applicationRoleName, privilege: "SELECT", grantable: false }]
      : row.relation_name === "ai_content_bootstrap_state" || row.relation_name === "ai_content_write_fence_catalog"
        ? [{ grantee: names.migrationRoleName, privilege: "SELECT", grantable: false }]
        : [];
    const ownerAcl = tableOwnerPrivileges.map((privilege) => ({ grantee: ownerRoleName, privilege, grantable: false }));
    if (row.owner_role_name !== ownerRoleName
      || exactJson(normalizeAcl(row.acl)) !== exactJson(normalizeAcl([...ownerAcl, ...extra]))) {
      throw new Error(`bootstrap_074_fence_security_control_mismatch:${row.relation_name}:${JSON.stringify({ owner: row.owner_role_name, acl: normalizeAcl(row.acl) })}`);
    }
  }
  const catalog = {
    functions: functionResult.rows,
    ordinaryTriggers: triggerResult.rows,
    fenceCatalog: catalogResult.rows,
    controlRelations: controlResult.rows,
  };
  return { ...catalog, canonicalJson: canonicalFenceSecurityCatalog(catalog), catalogSha256: hashFenceSecurityCatalog(catalog) };
}

export async function readCanonicalBootstrapCatalogs(client, names) {
  const roleNames = [names.schemaOwnerRoleName, names.applicationRoleName, names.operatorRoleName,
    names.migrationRoleName, names.cleanupRoleName];
  const roleResult = await client.query(
    `/* bootstrap_role_catalog_v3 */
     select role.rolname as role_name,role.rolcanlogin as can_login,role.rolsuper as is_superuser,
             role.rolbypassrls as bypass_rls,role.rolcreatedb as can_create_db,
             role.rolcreaterole as can_create_role,role.rolreplication as can_replicate,
             role.rolinherit as inherit
       from pg_roles role
      where role.rolname=any($1::name[])
       order by role.rolname`,
    [roleNames],
  );
  const membershipResult = await client.query(
    `/* bootstrap_role_membership_catalog_v2 */
     with recursive connected_roles(oid) as (
       select role.oid from pg_roles role where role.rolname=any($1::name[])
       union
       select case when membership.member=connected.oid then membership.roleid else membership.member end
         from connected_roles connected
         join pg_auth_members membership
           on membership.member=connected.oid or membership.roleid=connected.oid
     )
     select member.rolname as member_role_name,parent.rolname as parent_role_name,
            membership.set_option,membership.inherit_option,membership.admin_option
       from pg_auth_members membership
       join connected_roles connected_member on connected_member.oid=membership.member
       join connected_roles connected_parent on connected_parent.oid=membership.roleid
       join pg_roles member on member.oid=membership.member
       join pg_roles parent on parent.oid=membership.roleid
      order by member.rolname,parent.rolname`,
    [roleNames],
  );
  const roleCatalog = { roles: roleResult.rows, membershipEdges: membershipResult.rows };
  validateBootstrapRoleSafety(roleCatalog, names);
  const objectResult = await client.query(
    `/* bootstrap_object_catalog_v1 */
     select namespace.nspname as schema_name,relation.relname as relation_name,
            relation.relkind as relation_kind,owner.rolname as owner_role_name,
            coalesce(jsonb_agg(jsonb_build_object(
              'ordinal_position',attribute.attnum,'column_name',attribute.attname,
              'type_identity',format_type(attribute.atttypid,attribute.atttypmod),
              'not_null',attribute.attnotnull
            ) order by attribute.attnum) filter (where attribute.attnum is not null),'[]'::jsonb) as columns
       from pg_class relation
       join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
       join pg_roles owner on owner.oid=relation.relowner
       left join pg_attribute attribute on attribute.attrelid=relation.oid and attribute.attnum>0 and not attribute.attisdropped
      where relation.relname=any($1::name[])
      group by namespace.nspname,relation.relname,relation.relkind,owner.rolname
      order by relation.relname`,
    [bootstrapFenceRelations],
  );
  if (objectResult.rows.length !== bootstrapFenceRelations.length
    || objectResult.rows.some((row) => row.relation_kind !== "r" || row.owner_role_name !== names.schemaOwnerRoleName)) {
    throw new Error("bootstrap_object_catalog_invalid");
  }
  return {
    roleRows: roleResult.rows,
    membershipEdges: membershipResult.rows,
    objectRows: objectResult.rows,
    roleCatalogSha256: hashBootstrapRoleCatalog(roleCatalog),
    objectCatalogSha256: hashBootstrapObjectCatalog(objectResult.rows),
  };
}

const bootstrapAuthorizationPayloadKeys = Object.freeze([
    "contractVersion", "algorithm", "keyId", "providerAttestationKeyId", "providerAttestationPublicKeySha256",
    "providerEnforcementBundleSha256",
    "requestId", "migrationId", "migrationSha256",
    "imageDigest", "imageSourceLabel", "roleCatalogSha256", "objectCatalogSha256",
    "migrationRoleName", "schemaOwnerRoleName", "applicationRoleName",
    "operatorRoleName", "cleanupRoleName", "eventTriggerName",
    "eventTriggerFunction", "eventTriggerFunctionSha256",
    "eventTriggerEvent", "eventTriggerOwner", "eventTriggerTags",
    "eventTriggerDefinitionSha256", "eventTriggerCatalogBeforeSha256",
    "eventTriggerCatalogBeforeCount", "issuedAt", "expiresAt",
  ]);
const bootstrapAuthorizationEnvelopeKeys = Object.freeze([...bootstrapAuthorizationPayloadKeys, "signature"]);

export function canonicalBootstrapAuthorizationPayload(value) {
  assertExactObjectKeys(value, bootstrapAuthorizationPayloadKeys, "bootstrap_role_authorization_envelope_invalid");
  return JSON.stringify(Object.fromEntries(bootstrapAuthorizationPayloadKeys.map((key) => [key, value[key]])));
}

function bootstrapAuthorizationPayload(value) {
  assertExactObjectKeys(value, bootstrapAuthorizationEnvelopeKeys, "bootstrap_role_authorization_envelope_invalid");
  return Object.fromEntries(bootstrapAuthorizationPayloadKeys.map((key) => [key, value[key]]));
}

function exactHex(value, size) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${size}}$`).test(value);
}

function loadPinnedEd25519PublicKey(verification, errorPrefix) {
  if (!verification || typeof verification.publicKeyPem !== "string"
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(verification.expectedKeyId ?? "")
    || !exactHex(verification.expectedPublicKeySha256, 64)) {
    throw new Error(`${errorPrefix}_identity_invalid`);
  }
  let publicKey;
  try { publicKey = createPublicKey(verification.publicKeyPem); } catch { throw new Error(`${errorPrefix}_public_key_invalid`); }
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error(`${errorPrefix}_algorithm_invalid`);
  const fingerprint = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  if (fingerprint !== verification.expectedPublicKeySha256) throw new Error(`${errorPrefix}_fingerprint_invalid`);
  return publicKey;
}

function decodeCanonicalEd25519Signature(signatureValue, errorPrefix) {
  if (typeof signatureValue !== "string") throw new Error(`${errorPrefix}_signature_shape_invalid`);
  const signature = Buffer.from(signatureValue, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== signatureValue) {
    throw new Error(`${errorPrefix}_signature_shape_invalid`);
  }
  return signature;
}

function verifyPinnedEd25519(canonicalPayload, envelope, verification, errorPrefix) {
  if (envelope.algorithm !== "Ed25519" || envelope.keyId !== verification?.expectedKeyId) {
    throw new Error(`${errorPrefix}_identity_invalid`);
  }
  const publicKey = loadPinnedEd25519PublicKey(verification, errorPrefix);
  const signature = decodeCanonicalEd25519Signature(envelope.signature, errorPrefix);
  if (!verify(null, Buffer.from(canonicalPayload), publicKey, signature)) {
    throw new Error(`${errorPrefix}_signature_invalid`);
  }
}

export function validateBootstrapRoleAuthorization(authorization, context) {
  assertExactObjectKeys(authorization, bootstrapAuthorizationEnvelopeKeys, "bootstrap_role_authorization_envelope_invalid");
  if (!authorization || authorization.contractVersion !== "ai-content-bootstrap-role-authorization.v3") {
    throw new Error("bootstrap_role_authorization_contract_invalid");
  }
  verifyPinnedEd25519(
    canonicalBootstrapAuthorizationPayload(bootstrapAuthorizationPayload(authorization)),
    authorization,
    context.authorizationVerification,
    "bootstrap_role_authorization",
  );
  loadPinnedEd25519PublicKey(
    context.providerAttestationVerification,
    "bootstrap_role_authorization_provider",
  );
  if (authorization.providerAttestationKeyId !== context.providerAttestationVerification?.expectedKeyId
    || authorization.providerAttestationPublicKeySha256 !== context.providerAttestationVerification?.expectedPublicKeySha256) {
    throw new Error("bootstrap_role_authorization_provider_identity_mismatch");
  }
  if (authorization.providerEnforcementBundleSha256 !== providerEnforcementBundleSha256) {
    throw new Error("bootstrap_role_authorization_provider_bundle_mismatch");
  }
  const now = new Date(context.now ?? Date.now()).getTime();
  const issued = Date.parse(authorization.issuedAt);
  const expires = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || (!context.allowExpiredSealed && issued > now)) {
    throw new Error("bootstrap_role_authorization_not_yet_valid");
  }
  if ((!context.allowExpiredSealed && expires < now) || expires <= issued || expires-issued > 15*60*1000) {
    throw new Error("bootstrap_role_authorization_expired");
  }
  if (typeof authorization.requestId !== "string"
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(authorization.requestId)
    || !exactHex(authorization.migrationSha256, 64)
    || !/^sha256:[0-9a-f]{64}$/.test(authorization.imageDigest)
    || !exactHex(authorization.imageSourceLabel, 40)
    || !exactHex(authorization.roleCatalogSha256, 64)
    || !exactHex(authorization.objectCatalogSha256, 64)) {
    throw new Error("bootstrap_role_authorization_identity_invalid");
  }
  if (context.migration?.id !== bootstrap074MigrationId
    || authorization.migrationId !== context.migration.id
    || authorization.migrationSha256 !== context.migration.checksum) {
    throw new Error("bootstrap_role_authorization_migration_mismatch");
  }
  if (authorization.imageDigest !== context.imageDigest
    || authorization.imageSourceLabel !== context.imageSourceLabel) {
    throw new Error("bootstrap_role_authorization_image_mismatch");
  }
  if (authorization.roleCatalogSha256 !== context.roleCatalogSha256) {
    throw new Error("bootstrap_role_authorization_role_catalog_mismatch");
  }
  if (authorization.objectCatalogSha256 !== context.objectCatalogSha256) {
    throw new Error("bootstrap_role_authorization_object_catalog_mismatch");
  }
  if (!exactHex(authorization.eventTriggerCatalogBeforeSha256, 64)
    || !Number.isInteger(authorization.eventTriggerCatalogBeforeCount)
    || authorization.eventTriggerCatalogBeforeCount < 0
    || (context.eventTriggerCatalogBeforeSha256 !== undefined
      && authorization.eventTriggerCatalogBeforeSha256 !== context.eventTriggerCatalogBeforeSha256)
    || (context.eventTriggerCatalogBeforeCount !== undefined
      && authorization.eventTriggerCatalogBeforeCount !== context.eventTriggerCatalogBeforeCount)) {
    throw new Error("bootstrap_role_authorization_event_trigger_catalog_mismatch");
  }
  const roles = [authorization.schemaOwnerRoleName, authorization.applicationRoleName,
    authorization.operatorRoleName, authorization.migrationRoleName, authorization.cleanupRoleName];
  if (roles.some((role) => typeof role !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(role))
    || new Set(roles).size !== roles.length) {
    throw new Error("bootstrap_role_authorization_roles_invalid");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(authorization.eventTriggerName)
    || !/^[A-Za-z_][A-Za-z0-9_.]{0,126}$/.test(authorization.eventTriggerFunction)
    || !exactHex(authorization.eventTriggerFunctionSha256, 64)
    || authorization.eventTriggerEvent !== "ddl_command_end"
    || authorization.eventTriggerOwner !== "postgres"
    || !Array.isArray(authorization.eventTriggerTags)
    || JSON.stringify([...authorization.eventTriggerTags].sort(lexicalCompare)) !== JSON.stringify(required074DdlGuardTags)
    || authorization.eventTriggerTags.some((tag) => typeof tag !== "string" || !/^[A-Z][A-Z _]{1,63}$/.test(tag))
    || new Set(authorization.eventTriggerTags).size !== authorization.eventTriggerTags.length
    || !exactHex(authorization.eventTriggerDefinitionSha256, 64)
    || authorization.eventTriggerDefinitionSha256 !== hashEventTriggerDefinition({
      ...authorization,
      eventTriggerEnabled: "enabled",
    })) {
    throw new Error("bootstrap_role_authorization_event_trigger_invalid");
  }
  return authorization;
}

const providerAttestationPayloadKeys = Object.freeze(["contractVersion", "providerRequestSha256", "authorizationRequestId",
    "algorithm", "keyId",
    "action", "eventTriggerName", "eventTriggerFunction", "eventTriggerFunctionSha256",
    "eventTriggerEvent", "eventTriggerTags", "eventTriggerDefinitionSha256", "eventTriggerOwner", "eventTriggerEnabled",
    "migrationId", "migrationSha256", "imageDigest", "imageSourceLabel",
    "roleCatalogSha256", "objectCatalogSha256", "fenceSecurityCatalogSha256", "finalFenceSecurityCatalogSha256",
    "eventTriggerCatalogBeforeSha256", "eventTriggerCatalogBeforeCount",
    "eventTriggerCatalogAfterSha256", "eventTriggerCatalogAfterCount", "issuedAt"]);
const providerAttestationEnvelopeKeys = Object.freeze([...providerAttestationPayloadKeys, "signature"]);

export function canonicalProviderAttestationPayload(value) {
  const payload = Object.fromEntries(providerAttestationPayloadKeys.map((key) => [key, value[key]]));
  payload.eventTriggerTags = [...(value.eventTriggerTags ?? [])].map(String).sort(lexicalCompare);
  return JSON.stringify(payload);
}

export function canonicalProviderAttestationEnvelope(value) {
  assertExactObjectKeys(value, providerAttestationEnvelopeKeys, "provider_attestation_envelope_invalid");
  decodeCanonicalEd25519Signature(value.signature, "provider_attestation");
  return JSON.stringify({ ...JSON.parse(canonicalProviderAttestationPayload(value)), signature: value.signature });
}

export function hashProviderAttestationEnvelope(value) {
  return checksum(canonicalProviderAttestationEnvelope(value));
}

const revocationPayloadKeys = Object.freeze(["contractVersion", "authorizationRequestId", "providerRequestSha256",
  "migrationRoleName", "schemaOwnerRoleName", "evidenceSha256"]);
const revocationEnvelopeKeys = Object.freeze([...revocationPayloadKeys, "requestSha256"]);

export function canonicalMembershipRevocationPayload(value) {
  assertExactObjectKeys(value, revocationPayloadKeys, "bootstrap_074_revocation_evidence_invalid");
  return JSON.stringify(Object.fromEntries(revocationPayloadKeys.map((key) => [key, value[key]])));
}

export function hashMembershipRevocationPayload(value) {
  return checksum(canonicalMembershipRevocationPayload(value));
}

export function canonicalMembershipRevocationEnvelope(value) {
  assertExactObjectKeys(value, revocationEnvelopeKeys, "bootstrap_074_revocation_evidence_invalid");
  if (!exactHex(value.requestSha256, 64)) throw new Error("bootstrap_074_revocation_evidence_invalid");
  const payload = Object.fromEntries(revocationPayloadKeys.map((key) => [key, value[key]]));
  return JSON.stringify({ ...payload, requestSha256: value.requestSha256 });
}

export function hashMembershipRevocationEnvelope(value) {
  return checksum(canonicalMembershipRevocationEnvelope(value));
}

export function buildMembershipRevocationRequest(authorization, installRequest, evidenceSha256) {
  const payload = {
    contractVersion: "ai-content-074-membership-revocation-request.v2",
    authorizationRequestId: authorization.requestId,
    providerRequestSha256: installRequest.requestSha256,
    migrationRoleName: authorization.migrationRoleName,
    schemaOwnerRoleName: authorization.schemaOwnerRoleName,
    evidenceSha256,
  };
  return { ...payload, requestSha256: hashMembershipRevocationPayload(payload) };
}

export function validateMembershipRevocationEvidence(value, expected, storedEnvelopeSha256) {
  const canonical = canonicalMembershipRevocationEnvelope(value);
  const payload = Object.fromEntries(revocationPayloadKeys.map((key) => [key, value[key]]));
  if (value.requestSha256 !== hashMembershipRevocationPayload(payload)
    || !exactHex(storedEnvelopeSha256, 64)
    || storedEnvelopeSha256 !== checksum(canonical)
    || canonical !== canonicalMembershipRevocationEnvelope(expected)) {
    throw new Error("bootstrap_074_revocation_evidence_invalid");
  }
  return value;
}

const providerInstallPayloadKeys = Object.freeze(["contractVersion", "authorizationRequestId", "action", "eventTriggerName",
    "eventTriggerFunction", "eventTriggerFunctionSha256", "eventTriggerEvent", "eventTriggerTags",
    "eventTriggerOwner", "eventTriggerEnabled", "eventTriggerDefinitionSha256", "migrationId",
    "migrationSha256", "imageDigest", "imageSourceLabel", "roleCatalogSha256", "objectCatalogSha256",
    "schemaOwnerRoleName", "fenceSecurityCatalogSha256", "interimFenceSecurityCatalog",
    "expectedFinalFenceSecurityCatalogSha256", "expectedFinalFenceSecurityCatalog",
    "providerAttestationKeyId", "providerAttestationPublicKeySha256",
    "providerEnforcementBundleSha256",
    "eventTriggerCatalogBeforeSha256", "eventTriggerCatalogBeforeCount",
    "eventTriggerCatalogBefore"]);
const providerInstallEnvelopeKeys = Object.freeze([...providerInstallPayloadKeys, "requestSha256"]);

function canonicalProviderInstallRequest(value) {
  const errorCode = "bootstrap_074_install_request_invalid";
  assertExactObjectKeys(value, providerInstallPayloadKeys, errorCode);
  const request = Object.fromEntries(providerInstallPayloadKeys.map((key) => [key, value[key]]));
  request.eventTriggerTags = [...(value.eventTriggerTags ?? [])].map(String).sort(lexicalCompare);
  if (JSON.stringify(value.eventTriggerTags) !== JSON.stringify(request.eventTriggerTags)) throw new Error(errorCode);
  request.interimFenceSecurityCatalog = JSON.parse(validateStoredFenceSecurityCatalog(
    value.interimFenceSecurityCatalog, value.fenceSecurityCatalogSha256, errorCode,
  ));
  request.expectedFinalFenceSecurityCatalog = JSON.parse(validateStoredFenceSecurityCatalog(
    value.expectedFinalFenceSecurityCatalog, value.expectedFinalFenceSecurityCatalogSha256, errorCode,
  ));
  const derivedFinal = deriveExpectedFinalFenceSecurityCatalog(
    JSON.stringify(request.interimFenceSecurityCatalog), value.schemaOwnerRoleName,
  );
  if (derivedFinal.catalogSha256 !== value.expectedFinalFenceSecurityCatalogSha256
    || derivedFinal.canonicalJson !== JSON.stringify(request.expectedFinalFenceSecurityCatalog)) throw new Error(errorCode);
  request.eventTriggerCatalogBefore = JSON.parse(validateStoredEventTriggerCatalogEnvelope(
    value.eventTriggerCatalogBefore, value.eventTriggerCatalogBeforeSha256, value.eventTriggerCatalogBeforeCount,
  ));
  return JSON.stringify(request);
}

export function hashProviderEventTriggerInstallRequest(value) {
  return checksum(canonicalProviderInstallRequest(value));
}

function canonicalProviderInstallEnvelope(value) {
  const errorCode = "bootstrap_074_install_request_invalid";
  assertExactObjectKeys(value, providerInstallEnvelopeKeys, errorCode);
  if (!exactHex(value.requestSha256, 64)) throw new Error(errorCode);
  const payload = Object.fromEntries(providerInstallPayloadKeys.map((key) => [key, value[key]]));
  return JSON.stringify({ ...JSON.parse(canonicalProviderInstallRequest(payload)), requestSha256: value.requestSha256 });
}

function validateProviderEventTriggerInstallRequest(value, storedSha256) {
  const errorCode = "bootstrap_074_install_request_invalid";
  const canonicalEnvelope = canonicalProviderInstallEnvelope(value);
  if (!exactHex(storedSha256, 64)) throw new Error(errorCode);
  const payload = Object.fromEntries(providerInstallPayloadKeys.map((key) => [key, value[key]]));
  const requestSha256 = hashProviderEventTriggerInstallRequest(payload);
  if (value.requestSha256 !== requestSha256 || storedSha256 !== requestSha256) throw new Error(errorCode);
  return JSON.parse(canonicalEnvelope);
}

export function buildProviderEventTriggerInstallRequest(authorization, seals) {
  if (!exactHex(seals?.fenceSecurityCatalogSha256, 64)
    || typeof seals?.fenceSecurityCatalogCanonicalJson !== "string"
    || typeof seals?.eventTriggerCatalogBeforeCanonicalJson !== "string") {
    throw new Error("bootstrap_074_install_seals_required");
  }
  const request = {
    contractVersion: "ai-content-074-provider-install-request.v3",
    authorizationRequestId: authorization.requestId,
    action: "install_verify_074_enforcement_bundle",
    eventTriggerName: authorization.eventTriggerName,
    eventTriggerFunction: authorization.eventTriggerFunction,
    eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
    eventTriggerEvent: authorization.eventTriggerEvent,
    eventTriggerTags: [...authorization.eventTriggerTags].sort(lexicalCompare),
    eventTriggerOwner: authorization.eventTriggerOwner,
    eventTriggerEnabled: "enabled",
    eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
    migrationId: authorization.migrationId,
    migrationSha256: authorization.migrationSha256,
    imageDigest: authorization.imageDigest,
    imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256,
    objectCatalogSha256: authorization.objectCatalogSha256,
    schemaOwnerRoleName: authorization.schemaOwnerRoleName,
    fenceSecurityCatalogSha256: seals.fenceSecurityCatalogSha256,
    interimFenceSecurityCatalog: JSON.parse(seals.fenceSecurityCatalogCanonicalJson),
    expectedFinalFenceSecurityCatalogSha256: deriveExpectedFinalFenceSecurityCatalog(
      seals.fenceSecurityCatalogCanonicalJson, authorization.schemaOwnerRoleName,
    ).catalogSha256,
    expectedFinalFenceSecurityCatalog: deriveExpectedFinalFenceSecurityCatalog(
      seals.fenceSecurityCatalogCanonicalJson, authorization.schemaOwnerRoleName,
    ).catalog,
    providerAttestationKeyId: authorization.providerAttestationKeyId,
    providerAttestationPublicKeySha256: authorization.providerAttestationPublicKeySha256,
    providerEnforcementBundleSha256: authorization.providerEnforcementBundleSha256,
    eventTriggerCatalogBeforeSha256: authorization.eventTriggerCatalogBeforeSha256,
    eventTriggerCatalogBeforeCount: authorization.eventTriggerCatalogBeforeCount,
    eventTriggerCatalogBefore: JSON.parse(seals.eventTriggerCatalogBeforeCanonicalJson),
  };
  return { ...request, requestSha256: hashProviderEventTriggerInstallRequest(request) };
}

export function validateProviderEventTriggerAttestation(attestation, {
  authorization, installRequest, providerAttestationVerification, finalFenceSecurityCatalogSha256, now,
}) {
  if (!attestation || attestation.contractVersion !== providerAttestationContract) {
    throw new Error("provider_attestation_contract_invalid");
  }
  assertExactObjectKeys(attestation, providerAttestationEnvelopeKeys, "provider_attestation_envelope_invalid");
  verifyPinnedEd25519(
    canonicalProviderAttestationPayload(Object.fromEntries(providerAttestationPayloadKeys.map((key) => [key, attestation[key]]))),
    attestation,
    providerAttestationVerification,
    "provider_attestation",
  );
  const issued = Date.parse(attestation.issuedAt);
  const currentTime = new Date(now ?? Date.now()).getTime();
  if (!Number.isFinite(issued)
    || issued < Date.parse(authorization.issuedAt)
    || issued > Date.parse(authorization.expiresAt)
    || issued > currentTime) {
    throw new Error("provider_attestation_stale");
  }
  if (!exactHex(attestation.eventTriggerCatalogAfterSha256, 64)
    || !Number.isInteger(attestation.eventTriggerCatalogAfterCount)
    || !exactHex(attestation.finalFenceSecurityCatalogSha256, 64)) {
    throw new Error("provider_attestation_event_trigger_catalog_invalid");
  }
  const expected = {
    providerRequestSha256: installRequest.requestSha256,
    authorizationRequestId: authorization.requestId,
    action: "install_verify_074_enforcement_bundle",
    eventTriggerName: authorization.eventTriggerName,
    eventTriggerFunction: authorization.eventTriggerFunction,
    eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
    eventTriggerEvent: authorization.eventTriggerEvent,
    eventTriggerTags: [...authorization.eventTriggerTags].sort(lexicalCompare),
    eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
    eventTriggerOwner: "postgres",
    eventTriggerEnabled: "enabled",
    migrationId: authorization.migrationId,
    migrationSha256: authorization.migrationSha256,
    imageDigest: authorization.imageDigest,
    imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256,
    objectCatalogSha256: authorization.objectCatalogSha256,
    fenceSecurityCatalogSha256: installRequest.fenceSecurityCatalogSha256,
    finalFenceSecurityCatalogSha256,
    eventTriggerCatalogBeforeSha256: installRequest.eventTriggerCatalogBeforeSha256,
    eventTriggerCatalogBeforeCount: installRequest.eventTriggerCatalogBeforeCount,
    eventTriggerCatalogAfterSha256: attestation.eventTriggerCatalogAfterSha256,
    eventTriggerCatalogAfterCount: installRequest.eventTriggerCatalogBeforeCount + 1,
  };
  for (const [key, value] of Object.entries(expected)) {
    const matches = Array.isArray(value)
      ? JSON.stringify([...(attestation[key] ?? [])].sort(lexicalCompare)) === JSON.stringify(value)
      : attestation[key] === value;
    if (!matches) throw new Error(`provider_attestation_${key}_mismatch`);
  }
  return attestation;
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(identifier)) throw new Error("bootstrap_role_identifier_invalid");
  return `"${identifier}"`;
}

async function readLiveEventTriggerEvidence(client, authorization) {
  const live = await client.query(
    `/* bootstrap_event_trigger_catalog_v1 */
     select event_trigger.evtname as event_trigger_name,
            event_trigger.evtevent as event_trigger_event,
            coalesce(event_trigger.evttags,'{}'::text[]) as event_trigger_tags,
            owner.rolname as event_trigger_owner,
            case event_trigger.evtenabled when 'O' then 'enabled' else event_trigger.evtenabled::text end as event_trigger_enabled,
            namespace.nspname || '.' || function.proname as event_trigger_function,
            encode(digest(pg_get_functiondef(function.oid),'sha256'),'hex') as event_trigger_function_sha256
       from pg_event_trigger event_trigger
       join pg_roles owner on owner.oid=event_trigger.evtowner
       join pg_proc function on function.oid=event_trigger.evtfoid
       join pg_namespace namespace on namespace.oid=function.pronamespace
      where event_trigger.evtname=$1
         or event_trigger.evtname like 'ai_content_ddl_guard_%'
         or event_trigger.evtfoid=to_regprocedure($2)
      order by event_trigger.evtname`,
    [authorization.eventTriggerName, `${authorization.eventTriggerFunction}()`],
  );
  if (live.rows.length !== 1) throw new Error("bootstrap_074_live_event_trigger_conflict");
  const row = live.rows[0];
  const evidence = {
    eventTriggerName: row.event_trigger_name,
    eventTriggerEvent: row.event_trigger_event,
    eventTriggerTags: [...(row.event_trigger_tags ?? [])].map(String).sort(lexicalCompare),
    eventTriggerOwner: row.event_trigger_owner,
    eventTriggerEnabled: row.event_trigger_enabled,
    eventTriggerFunction: row.event_trigger_function,
    eventTriggerFunctionSha256: row.event_trigger_function_sha256,
  };
  const definitionSha256 = hashEventTriggerDefinition(evidence);
  if (evidence.eventTriggerName !== authorization.eventTriggerName
    || evidence.eventTriggerEvent !== authorization.eventTriggerEvent
    || JSON.stringify(evidence.eventTriggerTags) !== JSON.stringify([...authorization.eventTriggerTags].sort(lexicalCompare))
    || evidence.eventTriggerOwner !== authorization.eventTriggerOwner
    || evidence.eventTriggerEnabled !== "enabled"
    || evidence.eventTriggerFunction !== authorization.eventTriggerFunction
    || evidence.eventTriggerFunctionSha256 !== authorization.eventTriggerFunctionSha256
    || definitionSha256 !== authorization.eventTriggerDefinitionSha256) {
    throw new Error("bootstrap_074_live_event_trigger_mismatch");
  }
  return { ...evidence, eventTriggerDefinitionSha256: definitionSha256 };
}

function containsEventTriggerDdl(sql) {
  return topLevelStatements(sql).some((statement) => /^\s*(?:create|alter)\s+event\s+trigger\b/i.test(statement));
}

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

const transactionControlStatementPattern =
  /^(?:begin\b|start\s+transaction\b|prepare\s+transaction\b|commit\b|end\b|rollback\b|abort\b)/i;

function nestedTransactionControlError() {
  const error = new Error("migration_nested_transaction_control");
  error.code = "migration_nested_transaction_control";
  return error;
}

function isIdentifierContinuation(character) {
  return character !== undefined && /[A-Za-z0-9_$\u0080-\uFFFF]/u.test(character);
}

function startsEscapeString(sql, quoteIndex) {
  return /^[eE]$/.test(sql[quoteIndex - 1] ?? "")
    && !isIdentifierContinuation(sql[quoteIndex - 2]);
}

function topLevelStatements(sql) {
  const statements = [];
  let statement = "";
  let state = "code";
  let blockCommentDepth = 0;
  let dollarQuoteDelimiter = "";

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (state === "line_comment") {
      if (character === "\n") {
        state = "code";
        statement += "\n";
      }
      continue;
    }

    if (state === "block_comment") {
      if (character === "/" && nextCharacter === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === "*" && nextCharacter === "/") {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) state = "code";
      }
      continue;
    }

    if (state === "escape_single_quote") {
      if (character === "\\" && nextCharacter !== undefined) {
        index += 1;
      } else if (character === "'" && nextCharacter === "'") {
        index += 1;
      } else if (character === "'") {
        state = "code";
      }
      continue;
    }

    if (state === "single_quote") {
      if (character === "'" && nextCharacter === "'") {
        index += 1;
      } else if (character === "'") {
        state = "code";
      }
      continue;
    }

    if (state === "double_quote") {
      if (character === "\"" && nextCharacter === "\"") {
        index += 1;
      } else if (character === "\"") {
        state = "code";
      }
      continue;
    }

    if (state === "dollar_quote") {
      if (sql.startsWith(dollarQuoteDelimiter, index)) {
        index += dollarQuoteDelimiter.length - 1;
        state = "code";
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      statement += " ";
      state = "line_comment";
      index += 1;
    } else if (character === "/" && nextCharacter === "*") {
      statement += " ";
      state = "block_comment";
      blockCommentDepth = 1;
      index += 1;
    } else if (character === "'") {
      statement += " ";
      state = startsEscapeString(sql, index)
        ? "escape_single_quote"
        : "single_quote";
    } else if (character === "\"") {
      statement += " ";
      state = "double_quote";
    } else if (character === "$") {
      const delimiter = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter && !isIdentifierContinuation(sql[index - 1])) {
        statement += " ";
        state = "dollar_quote";
        dollarQuoteDelimiter = delimiter;
        index += delimiter.length - 1;
      } else {
        statement += character;
      }
    } else if (character === ";") {
      statements.push(statement);
      statement = "";
    } else {
      statement += character;
    }
  }

  if (statement.trim() !== "") statements.push(statement);
  return statements;
}

function containsTransactionControl(sql) {
  return topLevelStatements(sql).some((statement) =>
    transactionControlStatementPattern.test(statement.trim()),
  );
}

export function unwrapFileTransaction(sql) {
  const lines = sql.split(/\r?\n/);
  const significantLineIndexes = lines
    .map((line, index) => ({ index, trimmed: line.trim() }))
    .filter(({ trimmed }) => trimmed !== "" && !trimmed.startsWith("--"))
    .map(({ index }) => index);
  const firstIndex = significantLineIndexes[0];
  const lastIndex = significantLineIndexes.at(-1);
  const hasOuterWrapper = firstIndex !== undefined
    && lastIndex !== undefined
    && /^begin\s*;$/i.test(lines[firstIndex].trim())
    && /^commit\s*;$/i.test(lines[lastIndex].trim());
  const bodyLines = hasOuterWrapper
    ? lines.filter((_line, index) => index !== firstIndex && index !== lastIndex)
    : lines;

  if (containsTransactionControl(bodyLines.join("\n"))) {
    throw nestedTransactionControlError();
  }
  return bodyLines.join("\n");
}

export function resolveMigrationClientConfig(
  connectionString,
  { caCertificate } = {},
) {
  return resolveVerifiedTlsConfig(connectionString, { caCertificate });
}

function isCompatibleMigrationChecksum(id, storedChecksum, currentChecksum) {
  return compatibleMigrationChecksums[id]?.[storedChecksum] === currentChecksum;
}

export function buildMigrationPlan(migrations, applied) {
  const appliedById = new Map(applied.map((migration) => [migration.id, migration.checksum]));
  for (const migration of migrations) {
    const storedChecksum = appliedById.get(migration.id);
    if (
      appliedById.has(migration.id)
      && storedChecksum !== migration.checksum
      && !isCompatibleMigrationChecksum(migration.id, storedChecksum, migration.checksum)
    ) {
      throw new Error(`migration_checksum_mismatch:${migration.id}`);
    }
  }
  return { pending: migrations.filter((migration) => !appliedById.has(migration.id)) };
}

export async function loadMigrations(directory = defaultMigrationDirectory) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(files.map(async (id) => {
    const sql = await readFile(path.join(directory, id), "utf8");
    return { id, sql, checksum: checksum(sql) };
  }));
}

async function hasExistingApplicationSchema(client) {
  const result = await client.query("select to_regclass('public.workspaces') as relation");
  return Boolean(result.rows[0]?.relation);
}

async function ensureMigrationHistory(client) {
  await client.query(
    `create table if not exists schema_migrations (
       id text primary key,
       checksum text not null,
       applied_at timestamptz not null default now()
     )`
  );
}

async function readHistory(client) {
  const result = await client.query("select id, checksum from schema_migrations order by id asc");
  return result.rows;
}

async function baselineExistingSchema(client, migrations, baselineUpTo) {
  if (!baselineUpTo) throw new Error("migration_history_missing_baseline_required");
  const baselineIndex = migrations.findIndex((migration) => migration.id === baselineUpTo);
  if (baselineIndex < 0) throw new Error(`migration_baseline_not_found:${baselineUpTo}`);
  for (const migration of migrations.slice(0, baselineIndex + 1)) {
    await client.query(
      "insert into schema_migrations (id, checksum) values ($1, $2) on conflict (id) do nothing",
      [migration.id, migration.checksum]
    );
  }
}

export async function runMigrationsWithClient({
  client,
  migrations,
  baselineUpTo,
  dryRun = false,
  bootstrap074,
}) {
  await client.query("select pg_advisory_lock(hashtext($1))", [migrationAdvisoryLockName]);
  try {
    if (dryRun) {
      const historyTable = await client.query("select to_regclass('public.schema_migrations') as relation");
      if (!historyTable.rows[0]?.relation) {
        return { migrations, pending: migrations.map((migration) => migration.id), baselineRequired: await hasExistingApplicationSchema(client) };
      }
      const plan = buildMigrationPlan(migrations, await readHistory(client));
      return { migrations, pending: plan.pending.map((migration) => migration.id), baselineRequired: false };
    }
    const migration074 = migrations.find((migration) => migration.id === bootstrap074MigrationId);
    const contains074 = Boolean(migration074);
    if (contains074 && migrations.some((migration) => migration.id === "075_ai_content_three_format_cutover.sql")) {
      throw new Error("bootstrap_075_present_forbidden");
    }
    let history;
    let plan;
    if (contains074) {
      const historyTable = await client.query("select to_regclass('public.schema_migrations') as relation");
      if (!historyTable.rows[0]?.relation) throw new Error("bootstrap_074_pending_set_invalid");
      history = await readHistory(client);
      if (history.some((migration) => migration.id === "075_ai_content_three_format_cutover.sql")) {
        throw new Error("bootstrap_075_present_forbidden");
      }
      plan = buildMigrationPlan(migrations, history);
      const pendingIds = plan.pending.map((migration) => migration.id);
      const applying074 = pendingIds.includes(bootstrap074MigrationId);
      if ((applying074 && (pendingIds.length !== 1 || pendingIds[0] !== bootstrap074MigrationId))
        || (!applying074 && pendingIds.length !== 0)) {
        throw new Error("bootstrap_074_pending_set_invalid");
      }
    } else {
      await ensureMigrationHistory(client);
      history = await readHistory(client);
      if (history.length === 0 && await hasExistingApplicationSchema(client)) {
        await baselineExistingSchema(client, migrations, baselineUpTo);
        history = await readHistory(client);
      }
      plan = buildMigrationPlan(migrations, history);
    }
    let authorization;
    let liveCatalogs;
    let providerInstallRequest;
    let revocationRequest;
    let eventTriggerCatalog;
    let fenceSecurityCatalog;
    if (plan.pending.some((migration) => migration.id === bootstrap074MigrationId)) {
      if (!bootstrap074?.authorization) throw new Error("bootstrap_role_authorization_required");
      authorization = validateBootstrapRoleAuthorization(bootstrap074.authorization, {
        ...bootstrap074,
        migration: migration074,
        roleCatalogSha256: bootstrap074.authorization.roleCatalogSha256,
        objectCatalogSha256: bootstrap074.authorization.objectCatalogSha256,
      });
      const identity = await client.query("select session_user, current_user");
      if (identity.rows[0]?.session_user !== authorization.migrationRoleName
        || identity.rows[0]?.current_user !== authorization.migrationRoleName
        || identity.rows[0]?.session_user === authorization.schemaOwnerRoleName
        || identity.rows[0]?.session_user === "postgres") {
        throw new Error("bootstrap_role_session_identity_invalid");
      }
      liveCatalogs = await readCanonicalBootstrapCatalogs(client, authorization);
      if (authorization.roleCatalogSha256 !== liveCatalogs.roleCatalogSha256) {
        throw new Error("bootstrap_role_authorization_role_catalog_mismatch");
      }
      if (authorization.objectCatalogSha256 !== liveCatalogs.objectCatalogSha256) {
        throw new Error("bootstrap_role_authorization_object_catalog_mismatch");
      }
      eventTriggerCatalog = await readCanonicalEventTriggerCatalog(client);
      if (authorization.eventTriggerCatalogBeforeSha256 !== eventTriggerCatalog.catalogSha256
        || authorization.eventTriggerCatalogBeforeCount !== eventTriggerCatalog.count) {
        throw new Error("bootstrap_role_authorization_event_trigger_catalog_mismatch");
      }
    }
    for (const migration of plan.pending) {
      await client.query("begin");
      try {
        if (migration.id === bootstrap074MigrationId) {
          if (containsEventTriggerDdl(migration.sql)) throw new Error("bootstrap_074_event_trigger_ddl_forbidden");
          await client.query(`set local role ${quoteIdentifier(authorization.schemaOwnerRoleName)}`);
        }
        await client.query(unwrapFileTransaction(migration.sql));
        if (migration.id === bootstrap074MigrationId) {
          const appRole = quoteIdentifier(authorization.applicationRoleName);
          const operatorRole = quoteIdentifier(authorization.operatorRoleName);
          const migrationRole = quoteIdentifier(authorization.migrationRoleName);
          await client.query(`revoke all on table ai_content_cutovers,ai_content_cutover_status_events,ai_content_maintenance_state,ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog from ${appRole}`);
          await client.query(`grant select on table ai_content_maintenance_state to ${appRole}`);
          await client.query(`grant execute on function assert_ai_content_writable() to ${appRole}`);
          await client.query(`grant execute on function prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamptz,text,text,text,text,text),set_ai_content_maintenance(uuid,boolean),transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text) to ${operatorRole}`);
          await client.query(`grant select on table ai_content_bootstrap_state,ai_content_write_fence_catalog to ${migrationRole}`);
          await client.query(`grant execute on function ai_content_cutover_bypass_allowed(),verify_ai_content_write_fence_catalog(),consume_ai_content_provider_attestation() to ${migrationRole}`);
          const roleSafety = await client.query(
            `/* bootstrap_application_privileges_v1 */
             select exists (
                      select 1 from public.ai_content_write_fence_catalog catalog
                      join pg_class relation on relation.oid=to_regclass('public.' || catalog.relation_name)
                       where catalog.relation_class='customer_execution' and relation.relowner=app.oid
                    ) as app_owns_fenced_relation,
                    exists (
                      select 1 from (values
                        ('ai_content_cutovers'),('ai_content_cutover_status_events'),('ai_content_maintenance_state'),
                        ('ai_content_bootstrap_state'),('ai_content_ddl_allowlist'),('ai_content_write_fence_catalog')
                      ) control(relation_name)
                       where has_table_privilege(app.rolname,'public.' || control.relation_name,'INSERT,UPDATE,DELETE,TRUNCATE')
                    ) as app_control_dml,
                    not has_table_privilege(app.rolname,'public.ai_content_maintenance_state','SELECT')
                      or not has_function_privilege(app.rolname,'public.assert_ai_content_writable()','EXECUTE') as app_missing_minimum,
                    has_function_privilege(app.rolname,'public.ai_content_cutover_bypass_allowed()','EXECUTE')
                      or has_function_privilege(app.rolname,'public.prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamp with time zone,text,text,text,text,text)','EXECUTE')
                      or has_function_privilege(app.rolname,'public.set_ai_content_maintenance(uuid,boolean)','EXECUTE')
                      or has_function_privilege(app.rolname,'public.transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamp with time zone,text)','EXECUTE')
                      as app_forbidden_execute
               from pg_roles app where app.rolname=$1`,
            [authorization.applicationRoleName],
          );
          const safety = roleSafety.rows[0];
          if (!safety || safety.app_owns_fenced_relation || safety.app_control_dml
            || safety.app_missing_minimum || safety.app_forbidden_execute) {
            throw new Error("bootstrap_074_application_role_unsafe");
          }
          fenceSecurityCatalog = await readFenceSecurityCatalog(client, authorization);
          const unchangedEventCatalog = await readCanonicalEventTriggerCatalog(client);
          if (unchangedEventCatalog.catalogSha256 !== eventTriggerCatalog.catalogSha256
            || unchangedEventCatalog.count !== eventTriggerCatalog.count) {
            throw new Error("bootstrap_074_event_trigger_catalog_changed_during_stage_one");
          }
          providerInstallRequest = buildProviderEventTriggerInstallRequest(authorization, {
            fenceSecurityCatalogSha256: fenceSecurityCatalog.catalogSha256,
            fenceSecurityCatalogCanonicalJson: fenceSecurityCatalog.canonicalJson,
            eventTriggerCatalogBeforeCanonicalJson: eventTriggerCatalog.canonicalJson,
          });
          const authorizationSha256 = checksum(canonicalBootstrapAuthorizationPayload(bootstrapAuthorizationPayload(authorization)));
          await client.query(
            `insert into ai_content_bootstrap_state (
               singleton,authorization_request_id,authorization_sha256,
               migration_role_name,schema_owner_role_name,application_role_name,operator_role_name,cleanup_role_name,
               migration_sha256,role_catalog_sha256,object_catalog_sha256,fence_security_catalog_sha256,
               event_trigger_catalog_before_json,event_trigger_catalog_before_sha256,event_trigger_catalog_before_count,
               install_request_json,install_request_sha256
             ) values (true,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16)`,
            [authorization.requestId,authorizationSha256,authorization.migrationRoleName,
              authorization.schemaOwnerRoleName,authorization.applicationRoleName,authorization.operatorRoleName,
              authorization.cleanupRoleName,authorization.migrationSha256,authorization.roleCatalogSha256,
              authorization.objectCatalogSha256,fenceSecurityCatalog.catalogSha256,eventTriggerCatalog.canonicalJson,
              eventTriggerCatalog.catalogSha256,eventTriggerCatalog.count,JSON.stringify(providerInstallRequest),providerInstallRequest.requestSha256],
          );
        }
        await client.query("insert into schema_migrations (id, checksum) values ($1, $2)", [migration.id, migration.checksum]);
        if (migration.id === bootstrap074MigrationId) {
          await client.query("select verify_ai_content_write_fence_catalog()");
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    if (contains074 && !plan.pending.some((migration) => migration.id === bootstrap074MigrationId)
      && bootstrap074?.authorization) {
      authorization = validateBootstrapRoleAuthorization(bootstrap074.authorization, {
        ...bootstrap074,
        migration: migration074,
        roleCatalogSha256: bootstrap074.authorization.roleCatalogSha256,
        objectCatalogSha256: bootstrap074.authorization.objectCatalogSha256,
        allowExpiredSealed: true,
      });
      const verifierIdentity = await client.query("select session_user, current_user");
      if (verifierIdentity.rows[0]?.session_user !== authorization.migrationRoleName
        || verifierIdentity.rows[0]?.current_user !== authorization.migrationRoleName) {
        throw new Error("bootstrap_role_session_identity_invalid");
      }
      const bootstrapState = await client.query(
        `/* bootstrap_durable_state_v1 */
         select authorization_request_id,authorization_sha256,
                migration_role_name,schema_owner_role_name,application_role_name,operator_role_name,cleanup_role_name,
                migration_sha256,role_catalog_sha256,object_catalog_sha256,fence_security_catalog_sha256,
                final_fence_security_catalog_sha256,
                event_trigger_catalog_before_json,event_trigger_catalog_before_sha256,event_trigger_catalog_before_count,
                event_trigger_catalog_after_sha256,event_trigger_catalog_after_count,
                install_request_json,install_request_sha256,
                provider_attestation_json,provider_attestation_sha256,attestation_consumed_at,
                revocation_request_json,revocation_request_sha256
           from ai_content_bootstrap_state where singleton`,
      );
      const sealed = bootstrapState.rows[0];
      const authorizationSha256 = checksum(canonicalBootstrapAuthorizationPayload(bootstrapAuthorizationPayload(authorization)));
      const baselineCanonicalJson = sealed ? validateStoredEventTriggerCatalogEnvelope(
        sealed.event_trigger_catalog_before_json,
        sealed.event_trigger_catalog_before_sha256,
        sealed.event_trigger_catalog_before_count,
      ) : null;
      const expectedInstall = sealed ? buildProviderEventTriggerInstallRequest(authorization, {
        fenceSecurityCatalogSha256: sealed.fence_security_catalog_sha256,
        fenceSecurityCatalogCanonicalJson: JSON.stringify(sealed.install_request_json?.interimFenceSecurityCatalog),
        eventTriggerCatalogBeforeCanonicalJson: baselineCanonicalJson,
      }) : null;
      const sealedInstall = sealed
        ? validateProviderEventTriggerInstallRequest(sealed.install_request_json, sealed.install_request_sha256)
        : null;
      if (!sealed
        || sealed.authorization_request_id!==authorization.requestId
        || sealed.authorization_sha256!==authorizationSha256
        || sealed.migration_role_name!==authorization.migrationRoleName
        || sealed.schema_owner_role_name!==authorization.schemaOwnerRoleName
        || sealed.application_role_name!==authorization.applicationRoleName
        || sealed.operator_role_name!==authorization.operatorRoleName
        || sealed.cleanup_role_name!==authorization.cleanupRoleName
        || sealed.migration_sha256!==authorization.migrationSha256
        || sealed.role_catalog_sha256!==authorization.roleCatalogSha256
        || sealed.object_catalog_sha256!==authorization.objectCatalogSha256
        || sealed.event_trigger_catalog_before_sha256!==authorization.eventTriggerCatalogBeforeSha256
        || sealed.event_trigger_catalog_before_count!==authorization.eventTriggerCatalogBeforeCount
        || sealed.install_request_sha256!==expectedInstall.requestSha256
        || canonicalProviderInstallEnvelope(sealedInstall)!==canonicalProviderInstallEnvelope(expectedInstall)) {
        throw new Error("bootstrap_074_state_mismatch");
      }
      providerInstallRequest = sealedInstall;
      liveCatalogs = await readCanonicalBootstrapCatalogs(client, authorization);
      if (authorization.roleCatalogSha256 !== liveCatalogs.roleCatalogSha256
        || authorization.objectCatalogSha256 !== liveCatalogs.objectCatalogSha256) {
        throw new Error("bootstrap_074_live_catalog_mismatch");
      }
      await client.query("select verify_ai_content_write_fence_catalog()");
      eventTriggerCatalog = await readCanonicalEventTriggerCatalog(client);
      if (sealed.provider_attestation_sha256) {
        fenceSecurityCatalog = await readFenceSecurityCatalog(client, authorization, { ownerRoleName: "postgres" });
        if (fenceSecurityCatalog.catalogSha256 !== providerInstallRequest.expectedFinalFenceSecurityCatalogSha256
          || fenceSecurityCatalog.canonicalJson !== JSON.stringify(providerInstallRequest.expectedFinalFenceSecurityCatalog)
          || sealed.final_fence_security_catalog_sha256 !== providerInstallRequest.expectedFinalFenceSecurityCatalogSha256) {
          throw new Error("bootstrap_074_final_fence_security_catalog_mismatch");
        }
        const storedAttestation = validateProviderEventTriggerAttestation(sealed.provider_attestation_json, {
          authorization, installRequest: providerInstallRequest,
          providerAttestationVerification: bootstrap074.providerAttestationVerification,
          finalFenceSecurityCatalogSha256: providerInstallRequest.expectedFinalFenceSecurityCatalogSha256,
          now: bootstrap074.now,
        });
        const storedAttestationSha256 = hashProviderAttestationEnvelope(storedAttestation);
        if (storedAttestationSha256 !== sealed.provider_attestation_sha256) {
          throw new Error("provider_attestation_envelope_hash_mismatch");
        }
        if (bootstrap074.providerAttestation) {
          const suppliedAttestation = validateProviderEventTriggerAttestation(bootstrap074.providerAttestation, {
            authorization, installRequest: providerInstallRequest,
            providerAttestationVerification: bootstrap074.providerAttestationVerification,
            finalFenceSecurityCatalogSha256: providerInstallRequest.expectedFinalFenceSecurityCatalogSha256,
            now: bootstrap074.now,
          });
          if (hashProviderAttestationEnvelope(suppliedAttestation) !== storedAttestationSha256) {
            throw new Error("provider_attestation_replayed");
          }
        }
        const delta = validateEventTriggerCatalogDelta(baselineCanonicalJson, eventTriggerCatalog.rows, authorization);
        if (delta.catalogSha256 !== sealed.event_trigger_catalog_after_sha256
          || delta.count !== sealed.event_trigger_catalog_after_count) {
          throw new Error("bootstrap_074_live_event_trigger_catalog_mismatch");
        }
        await readLiveEventTriggerEvidence(client, authorization);
        const expectedRevocation = buildMembershipRevocationRequest(authorization, providerInstallRequest, storedAttestationSha256);
        validateMembershipRevocationEvidence(sealed.revocation_request_json, expectedRevocation, sealed.revocation_request_sha256);
        revocationRequest = expectedRevocation;
        if (!sealed.attestation_consumed_at) {
          if (!bootstrap074.providerAttestation) throw new Error("provider_attestation_file_required_for_consume");
          const consumed = await client.query("select consume_ai_content_provider_attestation() as consumed");
          if (consumed.rows[0]?.consumed !== true) throw new Error("provider_attestation_replayed");
        }
      } else {
        fenceSecurityCatalog = await readFenceSecurityCatalog(client, authorization);
        if (fenceSecurityCatalog.catalogSha256 !== sealed.fence_security_catalog_sha256
          || fenceSecurityCatalog.canonicalJson !== JSON.stringify(providerInstallRequest.interimFenceSecurityCatalog)) {
          throw new Error("bootstrap_074_fence_security_catalog_mismatch");
        }
        if (bootstrap074.providerAttestation) throw new Error("provider_attestation_not_persisted_by_provider");
        if (eventTriggerCatalog.catalogSha256 !== sealed.event_trigger_catalog_before_sha256
          || eventTriggerCatalog.count !== sealed.event_trigger_catalog_before_count) {
          throw new Error("bootstrap_074_live_event_trigger_catalog_mismatch");
        }
      }
    }
    return {
      migrations,
      pending: plan.pending.map((migration) => migration.id),
      baselineRequired: false,
      ...(providerInstallRequest ? { providerInstallRequest } : {}),
      ...(revocationRequest ? { revocationRequest } : {}),
    };
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [migrationAdvisoryLockName]);
  }
}

export async function runMigrations({
  connectionString,
  migrationsDirectory = defaultMigrationDirectory,
  baselineUpTo,
  dryRun = false,
  caCertificate,
  bootstrap074,
}) {
  if (!connectionString) throw new Error("database_url_required");
  const migrations = await loadMigrations(migrationsDirectory);
  const client = new Client(resolveMigrationClientConfig(connectionString, {
    caCertificate,
  }));
  await client.connect();
  try {
    return await runMigrationsWithClient({
      client,
      migrations,
      baselineUpTo,
      dryRun,
      bootstrap074,
    });
  } finally {
    await client.end();
  }
}
