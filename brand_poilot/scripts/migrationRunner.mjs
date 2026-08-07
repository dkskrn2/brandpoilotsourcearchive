import { createHash, createPublicKey, verify } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, readFile, readdir, lstat, link, unlink } from "node:fs/promises";
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
export const fullSourceMigrationIds = Object.freeze([
  "001_initial_schema.sql",
  "002_source_content_items.sql",
  "003_topic_rows_duplicate_policy.sql",
  "004_channel_connection_requests.sql",
  "005_content_topic_source_url_unique.sql",
  "006_image_render_jobs.sql",
  "007_kakao_auth.sql",
  "008_auto_approval_default.sql",
  "009_support_requests.sql",
  "010_remove_webflow.sql",
  "011_add_social_channels.sql",
  "012_source_crawl_runs.sql",
  "013_automation_runs.sql",
  "014_instagram_delivery_formats.sql",
  "015_delivery_format_legacy_channels.sql",
  "016_repair_topic_publish_group_schedule.sql",
  "017_preserve_topic_publish_group_status.sql",
  "018_repair_active_render_job_unique.sql",
  "019_threads_text_render_jobs.sql",
  "020_dm_wiki_core.sql",
  "021_dm_wiki_pgvector.sql",
  "022_instagram_login_auth_mode.sql",
  "023_wiki_include_disabled_owned_sources.sql",
  "024_wiki_index_all_owned_pages.sql",
  "025_dm_conversation_operations.sql",
  "026_wiki_versions_and_knowledge_items.sql",
  "027_wiki_search_v2.sql",
  "028_brand_profile_logo.sql",
  "029_instagram_hashtag_trends.sql",
  "030_multichannel_foundation.sql",
  "031_content_performance_dashboard.sql",
  "032_compounding_wiki_core.sql",
  "033_compounding_wiki_pgvector.sql",
  "034_worker_resource_limits.sql",
  "035_remove_webflow_and_split_content_status.sql",
  "036_harden_performance_and_wiki_activation.sql",
  "037_repair_orphaned_generation_outputs.sql",
  "038_fail_exhausted_generation_jobs.sql",
  "039_instagram_trend_connections.sql",
  "040_restore_support_requests.sql",
  "041_instagram_trend_page_optional.sql",
  "042_single_owned_source.sql",
  "043_support_request_responses.sql",
  "044_ai_content_studio_runtime.sql",
  "045_admin_api_foundation.sql",
  "046_content_quality_learning.sql",
  "047_ai_content_subject_analysis.sql",
  "048_ai_content_direct_social_publishing.sql",
  "049_brand_intelligence_onboarding.sql",
  "050_support_request_contact_phone.sql",
  "051_ai_content_subject_pipeline_v2.sql",
  "052_ai_content_subject_appeal_regeneration_keys.sql",
  "053_dm_manual_delivery_audit.sql",
  "054_feedback_submissions.sql",
  "055_brand_core_and_rules.sql",
  "056_product_service_library.sql",
  "057_wiki_source_kinds.sql",
  "058_avatar_and_reference_libraries.sql",
  "060_content_orchestration.sql",
  "061_avatar_image_checksum_uniqueness.sql",
  "062_avatar_upload_cancellation.sql",
  "063_avatar_upload_finalization.sql",
  "064_reference_upload_finalization.sql",
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
]);
const legacyTriggerSearchPathMigrationId = "073a_legacy_trigger_function_search_path.sql";
export const legacyTriggerSearchPathMigrationChecksum =
  "5acce238ce19656738aff6e311d7f3db4a9763c5aee8a3ea1d6e338ce6f84001";
const bootstrap074MigrationId = "074_ai_content_maintenance_write_fence.sql";
const providerAttestationContract = "ai-content-074-provider-attestation.v4";

const isExactFullSourceManifest = (migrations) => migrations.length === fullSourceMigrationIds.length
  && migrations.every((migration, index) => migration.id === fullSourceMigrationIds[index]);
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
  "review_events", "source_crawl_runs", "storage_artifacts", "topic_publish_groups", "topic_rows", "topic_uploads",
]);
export const bootstrapTriggerFunctionDependencies = Object.freeze([Object.freeze({
  triggerFunctionIdentity: "public.revoke_ai_content_one_time_avatar_on_attachment_unavailable()",
  dependencyFunctionIdentities: Object.freeze([
    "public.revoke_ai_content_one_time_avatar_receipt(uuid,text)",
  ]),
})]);
export const legacyTriggerSearchPathFunctionIdentities = Object.freeze([
  "public.ai_content_attachment_upload_sessions_immutable_metadata()",
  "public.ai_content_v2_freeze_batch_input_snapshot()",
  "public.ai_content_v2_freeze_output_plan()",
  "public.ai_content_v2_reject_snapshot_mutation()",
  "public.enforce_ai_content_attachment_upload_session_transition()",
  "public.enqueue_ai_content_attachment_deletion()",
  "public.enqueue_ai_content_upload_session_deletion()",
  "public.reject_ai_content_analyzed_subject_snapshot_mutation()",
  "public.reject_ai_content_approved_proposal_version_mutation()",
  "public.reject_ai_content_generation_brief_mutation()",
  "public.reject_ai_content_one_time_avatar_receipt_mutation()",
  "public.reject_ai_content_one_time_avatar_revocation_mutation()",
  "public.reject_ai_content_wiki_version_snapshot_mutation()",
  "public.release_ai_content_attachment_storage_path()",
  "public.reserve_ai_content_attachment_storage_path()",
  "public.revoke_ai_content_one_time_avatar_on_attachment_unavailable()",
  "public.seal_ai_content_one_time_avatar_receipt_from_upload()",
  "public.set_updated_at()",
  "public.revoke_ai_content_one_time_avatar_receipt(uuid,text)",
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

export const cutover075FenceCatalog = Object.freeze([
  "ai_content_cutover_release_adoption_events",
  "ai_content_cutover_release_adoptions",
  "ai_content_generation_operations",
  "ai_content_generation_prompt_bindings",
  "ai_content_proposal_attempt_events",
  "ai_content_proposal_compositions",
  "ai_content_proposal_job_contracts",
  "ai_content_proposal_model_attempts",
  "ai_content_proposal_performance_audits",
  "ai_content_proposal_research_attempt_events",
  "ai_content_proposal_research_attempts",
  "ai_content_storage_cleanup_outbox",
  "automated_content_proposal_runs",
].map((relation_name) => Object.freeze({
  relation_name,
  relation_class: [
    "ai_content_cutover_release_adoption_events",
    "ai_content_cutover_release_adoptions",
    "ai_content_storage_cleanup_outbox",
  ].includes(relation_name) ? "cutover_control" : "customer_execution",
  row_classifier: "whole_relation",
})));

const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function assertExactObjectKeys(value, keys, errorCode) {
  const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)
    || JSON.stringify(Object.keys(value).sort(lexicalCompare)) !== JSON.stringify([...keys].sort(lexicalCompare))) {
    throw new Error(errorCode);
  }
}

export function canonicalBootstrapRoleCatalog({
  roles: roleRows, membershipEdges: edgeRows, databaseSettings: settingRows = [],
  database: databaseRow, publicSchema: publicSchemaRow,
}) {
  const roles = roleRows.map((row) => ({
    roleName: String(row.role_name),
    canLogin: row.can_login === true,
    isSuperuser: row.is_superuser === true,
    bypassRls: row.bypass_rls === true,
    canCreateDatabase: row.can_create_db === true,
    canCreateRole: row.can_create_role === true,
    canReplicate: row.can_replicate === true,
    inherit: row.inherit === true,
    config: [...(row.config ?? [])].map((item) => String(item).replace(/\s+/g, "")),
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
  const databaseSettings = settingRows.map((row) => ({
    roleName: String(row.role_name ?? row.roleName),
    databaseName: (row.database_name ?? row.databaseName) == null
      ? null : String(row.database_name ?? row.databaseName),
    settings: [...(row.settings ?? [])].map((item) => String(item).replace(/\s+/g, "")),
  })).sort((left, right) => lexicalCompare(
    `${left.roleName}\0${left.databaseName ?? ""}`,
    `${right.roleName}\0${right.databaseName ?? ""}`,
  ));
  const database = {
    databaseName: String(databaseRow?.database_name ?? databaseRow?.databaseName),
    ownerRoleName: String(databaseRow?.owner_role_name ?? databaseRow?.ownerRoleName),
  };
  const publicSchema = {
    ownerRoleName: String(publicSchemaRow?.owner_role_name ?? publicSchemaRow?.ownerRoleName),
    acl: normalizeAcl(publicSchemaRow?.acl),
  };
  return JSON.stringify({
    contractVersion: "ai-content-bootstrap-role-catalog.v5",
    roles,
    membershipEdges,
    databaseSettings,
    database,
    publicSchema,
  });
}

export function hashBootstrapRoleCatalog(catalog) {
  return checksum(canonicalBootstrapRoleCatalog(catalog));
}

function normalizeCatalogColumns(rows = []) {
  return [...rows].map((column) => ({
    ordinalPosition: Number(column.ordinal_position ?? column.ordinalPosition),
    columnName: String(column.column_name ?? column.columnName),
    typeIdentity: String(column.type_identity ?? column.typeIdentity),
    collationIdentity: (column.collation_identity ?? column.collationIdentity) == null
      ? null : String(column.collation_identity ?? column.collationIdentity),
    notNull: (column.not_null ?? column.notNull) === true,
    defaultDefinition: (column.default_definition ?? column.defaultDefinition) == null
      ? null : String(column.default_definition ?? column.defaultDefinition),
    identityKind: String(column.identity_kind ?? column.identityKind ?? ""),
    generatedKind: String(column.generated_kind ?? column.generatedKind ?? ""),
    acl: normalizeAcl(column.acl),
  })).sort((left, right) => left.ordinalPosition-right.ordinalPosition
    || lexicalCompare(left.columnName, right.columnName));
}

function normalizeCatalogConstraints(rows = []) {
  return [...rows].map((constraint) => ({
    constraintName: String(constraint.constraint_name ?? constraint.constraintName),
    constraintType: String(constraint.constraint_type ?? constraint.constraintType),
    definition: String(constraint.definition),
    validated: constraint.validated === true,
    deferrable: constraint.deferrable === true,
    initiallyDeferred: (constraint.initially_deferred ?? constraint.initiallyDeferred) === true,
  })).sort((left, right) => lexicalCompare(
    `${left.constraintName}\0${left.constraintType}\0${left.definition}`,
    `${right.constraintName}\0${right.constraintType}\0${right.definition}`,
  ));
}

function normalizeCatalogIndexes(rows = []) {
  return [...rows].map((index) => ({
    indexName: String(index.index_name ?? index.indexName),
    definition: String(index.definition),
    primary: index.primary === true,
    unique: index.unique === true,
    valid: index.valid === true,
    ready: index.ready === true,
    live: index.live === true,
  })).sort((left, right) => lexicalCompare(left.indexName, right.indexName));
}

function normalizeCatalogRules(rows = []) {
  return [...rows].map((rule) => ({
    ruleName: String(rule.rule_name ?? rule.ruleName),
    event: String(rule.event),
    enabled: String(rule.enabled),
    instead: rule.instead === true,
    definition: String(rule.definition),
  })).sort((left, right) => lexicalCompare(left.ruleName, right.ruleName));
}

function normalizeCatalogPolicies(rows = []) {
  return [...rows].map((policy) => ({
    policyName: String(policy.policy_name ?? policy.policyName),
    permissive: policy.permissive === true,
    roles: [...(policy.roles ?? [])].map(String).sort(lexicalCompare),
    command: String(policy.command),
    qual: policy.qual == null ? null : String(policy.qual),
    withCheck: (policy.with_check ?? policy.withCheck) == null
      ? null : String(policy.with_check ?? policy.withCheck),
  })).sort((left, right) => lexicalCompare(left.policyName, right.policyName));
}

function normalizeInternalConstraintTriggers(rows = []) {
  return [...rows].map((trigger) => ({
    constraintIdentity: String(trigger.constraint_identity ?? trigger.constraintIdentity),
    triggerName: String(trigger.trigger_name ?? trigger.triggerName),
    triggerType: Number(trigger.trigger_type ?? trigger.triggerType),
    enabled: String(trigger.enabled),
    deferrable: trigger.deferrable === true,
    initiallyDeferred: (trigger.initially_deferred ?? trigger.initiallyDeferred) === true,
    functionIdentity: String(trigger.function_identity ?? trigger.functionIdentity),
    definition: String(trigger.definition),
  })).sort((left, right) => lexicalCompare(
    `${left.constraintIdentity}\0${left.triggerName}`,
    `${right.constraintIdentity}\0${right.triggerName}`,
  ));
}

function normalizeRelationStructure(row) {
  return {
    relationKind: String(row.relation_kind ?? row.relationKind),
    relationPersistence: String(row.relation_persistence ?? row.relationPersistence),
    replicaIdentity: String(row.replica_identity ?? row.replicaIdentity),
    isPartition: (row.is_partition ?? row.isPartition) === true,
    partitionBound: (row.partition_bound ?? row.partitionBound) == null
      ? null : String(row.partition_bound ?? row.partitionBound),
    inheritanceParents: [...(row.inheritance_parents ?? row.inheritanceParents ?? [])]
      .map(String).sort(lexicalCompare),
    internalConstraintTriggers: normalizeInternalConstraintTriggers(
      row.internal_constraint_triggers ?? row.internalConstraintTriggers,
    ),
    rowSecurity: (row.row_security ?? row.rowSecurity) === true,
    forceRowSecurity: (row.force_row_security ?? row.forceRowSecurity) === true,
    ownerRoleName: String(row.owner_role_name ?? row.ownerRoleName),
    acl: normalizeAcl(row.acl),
    columns: normalizeCatalogColumns(row.columns),
    constraints: normalizeCatalogConstraints(row.constraints),
    indexes: normalizeCatalogIndexes(row.indexes),
    rules: normalizeCatalogRules(row.rules),
    policies: normalizeCatalogPolicies(row.policies),
  };
}

const liveAclIsValid = (rows) => Array.isArray(rows) && rows.every((acl) => acl != null
  && typeof acl.grantee === "string" && acl.grantee.length > 0
  && typeof acl.privilege === "string" && acl.privilege.length > 0
  && typeof acl.grantable === "boolean");

function liveRelationStructureIsValid(row) {
  return row?.relation_kind === "r" && row.relation_persistence === "p"
    && typeof row.replica_identity === "string" && /^[dnfi]$/.test(row.replica_identity)
    && row.is_partition === false && row.partition_bound === null
    && Array.isArray(row.inheritance_parents) && row.inheritance_parents.length === 0
    && Array.isArray(row.internal_constraint_triggers)
    && row.internal_constraint_triggers.every((trigger) => trigger != null
      && typeof trigger.constraint_identity === "string" && trigger.constraint_identity.length > 0
      && typeof trigger.trigger_name === "string" && trigger.trigger_name.length > 0
      && Number.isInteger(Number(trigger.trigger_type)) && typeof trigger.enabled === "string"
      && trigger.enabled !== "D" && typeof trigger.deferrable === "boolean"
      && typeof trigger.initially_deferred === "boolean"
      && typeof trigger.function_identity === "string" && trigger.function_identity.length > 0
      && typeof trigger.definition === "string" && trigger.definition.length > 0)
    && typeof row.row_security === "boolean"
    && typeof row.force_row_security === "boolean" && typeof row.owner_role_name === "string"
    && liveAclIsValid(row.acl) && Array.isArray(row.columns) && Array.isArray(row.constraints)
    && Array.isArray(row.indexes) && Array.isArray(row.rules) && Array.isArray(row.policies)
    && row.columns.every((column) => Number.isInteger(Number(column.ordinal_position))
      && Number(column.ordinal_position) > 0 && typeof column.column_name === "string"
      && typeof column.type_identity === "string"
      && (column.collation_identity === null || typeof column.collation_identity === "string")
      && typeof column.not_null === "boolean"
      && (column.default_definition === null || typeof column.default_definition === "string")
      && typeof column.identity_kind === "string" && typeof column.generated_kind === "string"
      && liveAclIsValid(column.acl))
    && row.constraints.every((constraint) => typeof constraint.constraint_name === "string"
      && typeof constraint.constraint_type === "string" && typeof constraint.definition === "string"
      && typeof constraint.validated === "boolean" && typeof constraint.deferrable === "boolean"
      && typeof constraint.initially_deferred === "boolean")
    && row.indexes.every((index) => typeof index.index_name === "string" && typeof index.definition === "string"
      && typeof index.primary === "boolean" && typeof index.unique === "boolean"
      && typeof index.valid === "boolean" && typeof index.ready === "boolean" && typeof index.live === "boolean")
    && row.rules.every((rule) => typeof rule.rule_name === "string" && typeof rule.event === "string"
      && typeof rule.enabled === "string" && typeof rule.instead === "boolean" && typeof rule.definition === "string")
    && row.policies.every((policy) => typeof policy.policy_name === "string" && typeof policy.permissive === "boolean"
      && Array.isArray(policy.roles) && policy.roles.every((role) => typeof role === "string")
      && typeof policy.command === "string" && (policy.qual === null || typeof policy.qual === "string")
      && (policy.with_check === null || typeof policy.with_check === "string"));
}

const relationStructureProjectionSql = `
       relation.relkind as relation_kind,relation.relpersistence as relation_persistence,
       relation.relreplident as replica_identity,relation.relispartition as is_partition,
       case when relation.relispartition then pg_get_expr(relation.relpartbound,relation.oid,true)
         else null end as partition_bound,
       coalesce((select array_agg(parent_namespace.nspname || '.' || parent.relname
         order by parent_namespace.nspname collate "C",parent.relname collate "C")
         from pg_inherits inheritance
         join pg_class parent on parent.oid=inheritance.inhparent
         join pg_namespace parent_namespace on parent_namespace.oid=parent.relnamespace
        where inheritance.inhrelid=relation.oid),'{}'::text[]) as inheritance_parents,
       coalesce((select jsonb_agg(jsonb_build_object(
         'constraint_identity',constraint_relation_namespace.nspname || '.' ||
           constraint_relation.relname || '.' || constraint_record.conname,
         'trigger_name',internal_trigger.tgname,'trigger_type',internal_trigger.tgtype::integer,
         'enabled',internal_trigger.tgenabled,'deferrable',internal_trigger.tgdeferrable,
         'initially_deferred',internal_trigger.tginitdeferred,
         'function_identity',internal_function_namespace.nspname || '.' || internal_function.proname ||
           '(' || pg_get_function_identity_arguments(internal_function.oid) || ')',
         'definition',pg_get_triggerdef(internal_trigger.oid,true)
       ) order by constraint_relation_namespace.nspname collate "C",
         constraint_relation.relname collate "C",constraint_record.conname collate "C",
         internal_trigger.tgname collate "C")
         from pg_trigger internal_trigger
         join pg_constraint constraint_record on constraint_record.oid=internal_trigger.tgconstraint
         join pg_class constraint_relation on constraint_relation.oid=constraint_record.conrelid
         join pg_namespace constraint_relation_namespace
           on constraint_relation_namespace.oid=constraint_relation.relnamespace
         join pg_proc internal_function on internal_function.oid=internal_trigger.tgfoid
         join pg_namespace internal_function_namespace
           on internal_function_namespace.oid=internal_function.pronamespace
        where internal_trigger.tgrelid=relation.oid and internal_trigger.tgisinternal
          and internal_trigger.tgconstraint<>0),'[]'::jsonb) as internal_constraint_triggers,
       relation.relrowsecurity as row_security,
       relation.relforcerowsecurity as force_row_security,owner.rolname as owner_role_name,
       coalesce((select jsonb_agg(jsonb_build_object(
         'grantee',case acl.grantee when 0 then 'PUBLIC' else grantee.rolname end,
         'privilege',acl.privilege_type,'grantable',acl.is_grantable
       ) order by (case acl.grantee when 0 then 'PUBLIC' else grantee.rolname end) collate "C",
         acl.privilege_type collate "C")
         from aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
         left join pg_roles grantee on grantee.oid=acl.grantee),'[]'::jsonb) as acl,
       coalesce((select jsonb_agg(jsonb_build_object(
         'ordinal_position',attribute.attnum,'column_name',attribute.attname,
         'type_identity',format_type(attribute.atttypid,attribute.atttypmod),
         'collation_identity',case when attribute.attcollation=0 then null
           else collation_namespace.nspname || '.' || catalog_collation.collname end,
         'not_null',attribute.attnotnull,
         'default_definition',pg_get_expr(default_value.adbin,default_value.adrelid,true),
         'identity_kind',attribute.attidentity,'generated_kind',attribute.attgenerated,
         'acl',coalesce((select jsonb_agg(jsonb_build_object(
           'grantee',case column_acl.grantee when 0 then 'PUBLIC' else column_grantee.rolname end,
           'privilege',column_acl.privilege_type,'grantable',column_acl.is_grantable
         ) order by (case column_acl.grantee when 0 then 'PUBLIC' else column_grantee.rolname end) collate "C",
           column_acl.privilege_type collate "C")
           from aclexplode(attribute.attacl) column_acl
           left join pg_roles column_grantee on column_grantee.oid=column_acl.grantee),'[]'::jsonb)
       ) order by attribute.attnum)
         from pg_attribute attribute
         left join pg_attrdef default_value on default_value.adrelid=attribute.attrelid
           and default_value.adnum=attribute.attnum
         left join pg_collation catalog_collation on catalog_collation.oid=attribute.attcollation
         left join pg_namespace collation_namespace on collation_namespace.oid=catalog_collation.collnamespace
        where attribute.attrelid=relation.oid and attribute.attnum>0
          and not attribute.attisdropped),'[]'::jsonb) as columns,
       coalesce((select jsonb_agg(jsonb_build_object(
         'constraint_name',catalog_constraint.conname,'constraint_type',catalog_constraint.contype,
         'definition',pg_get_constraintdef(catalog_constraint.oid,true),
         'validated',catalog_constraint.convalidated,'deferrable',catalog_constraint.condeferrable,
         'initially_deferred',catalog_constraint.condeferred
       ) order by catalog_constraint.conname collate "C",catalog_constraint.contype)
         from pg_constraint catalog_constraint
        where catalog_constraint.conrelid=relation.oid),'[]'::jsonb) as constraints,
       coalesce((select jsonb_agg(jsonb_build_object(
         'index_name',index_relation.relname,'definition',pg_get_indexdef(catalog_index.indexrelid,0,true),
         'primary',catalog_index.indisprimary,'unique',catalog_index.indisunique,
         'valid',catalog_index.indisvalid,'ready',catalog_index.indisready,'live',catalog_index.indislive
       ) order by index_relation.relname collate "C")
         from pg_index catalog_index
         join pg_class index_relation on index_relation.oid=catalog_index.indexrelid
        where catalog_index.indrelid=relation.oid),'[]'::jsonb) as indexes,
       coalesce((select jsonb_agg(jsonb_build_object(
         'rule_name',rule.rulename,'event',rule.ev_type::text,'enabled',rule.ev_enabled,
         'instead',rule.is_instead,'definition',pg_get_ruledef(rule.oid,true)
       ) order by rule.rulename collate "C")
         from pg_rewrite rule where rule.ev_class=relation.oid
           and not (relation.relkind in ('v','m') and rule.rulename='_RETURN')),'[]'::jsonb) as rules,
       coalesce((select jsonb_agg(jsonb_build_object(
         'policy_name',policy.polname,'permissive',policy.polpermissive,
         'roles',coalesce((select array_agg(case expanded_role.role_oid when 0 then 'PUBLIC' else policy_role.rolname end
             order by (case expanded_role.role_oid when 0 then 'PUBLIC' else policy_role.rolname end) collate "C")
           from unnest(policy.polroles) as expanded_role(role_oid)
           left join pg_roles policy_role on policy_role.oid=expanded_role.role_oid),'{}'::text[]),
         'command',policy.polcmd::text,'qual',pg_get_expr(policy.polqual,policy.polrelid,true),
         'with_check',pg_get_expr(policy.polwithcheck,policy.polrelid,true)
       ) order by policy.polname collate "C")
         from pg_policy policy where policy.polrelid=relation.oid),'[]'::jsonb) as policies`;

function normalizeFunctionCatalog(row) {
  return {
    identity: String(row.identity),
    definitionSha256: String(row.definition_sha256 ?? row.definitionSha256),
    sourceSha256: String(row.source_sha256 ?? row.sourceSha256),
    ownerRoleName: String(row.owner_role_name ?? row.ownerRoleName),
    securityDefiner: (row.security_definer ?? row.securityDefiner) === true,
    languageName: String(row.language_name ?? row.languageName),
    functionKind: String(row.function_kind ?? row.functionKind),
    volatility: String(row.volatility),
    parallelSafety: String(row.parallel_safety ?? row.parallelSafety),
    leakproof: row.leakproof === true,
    strict: row.strict === true,
    returnSet: (row.return_set ?? row.returnSet) === true,
    returnTypeIdentity: String(row.return_type_identity ?? row.returnTypeIdentity),
    config: [...(row.config ?? [])].map((item) => String(item).replace(/\s+/g, "")).sort(lexicalCompare),
    acl: normalizeAcl(row.acl),
  };
}

function liveFunctionCatalogIsValid(row) {
  return row != null && typeof row.identity === "string" && row.identity.length > 0
    && exactHex(row.definition_sha256, 64) && exactHex(row.source_sha256, 64)
    && typeof row.owner_role_name === "string" && row.owner_role_name.length > 0
    && typeof row.security_definer === "boolean" && typeof row.language_name === "string"
    && typeof row.function_kind === "string" && typeof row.volatility === "string"
    && typeof row.parallel_safety === "string" && typeof row.leakproof === "boolean"
    && typeof row.strict === "boolean" && typeof row.return_set === "boolean"
    && typeof row.return_type_identity === "string"
    && Array.isArray(row.config) && row.config.every((item) => typeof item === "string")
    && liveAclIsValid(row.acl);
}

const triggerFunctionDependencyIdentities = new Map(bootstrapTriggerFunctionDependencies.map((entry) => [
  entry.triggerFunctionIdentity,
  [...entry.dependencyFunctionIdentities].sort(lexicalCompare),
]));

function normalizeTriggerFunctionCatalog(row) {
  return {
    ...normalizeFunctionCatalog(row),
    dependencyFunctions: [...(row.dependency_functions ?? row.dependencyFunctions ?? [])]
      .map(normalizeFunctionCatalog)
      .sort((left, right) => lexicalCompare(left.identity, right.identity)),
  };
}

function liveTriggerFunctionCatalogIsValid(row, triggerFunctionIdentity) {
  if (!liveFunctionCatalogIsValid(row) || row.identity !== triggerFunctionIdentity
    || !Array.isArray(row.dependency_functions)
    || row.dependency_functions.some((dependency) => !liveFunctionCatalogIsValid(dependency))) return false;
  const actualIdentities = row.dependency_functions.map(({ identity }) => identity).sort(lexicalCompare);
  const expectedIdentities = triggerFunctionDependencyIdentities.get(triggerFunctionIdentity) ?? [];
  return exactJson(actualIdentities) === exactJson(expectedIdentities);
}

function liveCatalogTriggerIsValid(trigger) {
  return trigger != null && typeof trigger.trigger_name === "string"
    && typeof trigger.definition === "string" && typeof trigger.enabled === "string"
    && typeof trigger.deferrable === "boolean" && typeof trigger.initially_deferred === "boolean"
    && typeof trigger.function_identity === "string"
    && liveTriggerFunctionCatalogIsValid(trigger.function_catalog, trigger.function_identity);
}

const functionCatalogJsonSql = ({ functionAlias, namespaceAlias, ownerAlias, languageAlias,
  returnTypeAlias, returnNamespaceAlias, aclAlias, aclGranteeAlias,
  identitySql = `${namespaceAlias}.nspname || '.' || ${functionAlias}.proname || '(' || pg_get_function_identity_arguments(${functionAlias}.oid) || ')'`,
}) => `jsonb_build_object(
    'identity',${identitySql},
    'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(${functionAlias}.oid),'UTF8')),'hex'),
    'source_sha256',encode(sha256(convert_to(${functionAlias}.prosrc,'UTF8')),'hex'),
    'owner_role_name',${ownerAlias}.rolname,'security_definer',${functionAlias}.prosecdef,
    'language_name',${languageAlias}.lanname,'function_kind',${functionAlias}.prokind,
    'volatility',${functionAlias}.provolatile,'parallel_safety',${functionAlias}.proparallel,
    'leakproof',${functionAlias}.proleakproof,'strict',${functionAlias}.proisstrict,
    'return_set',${functionAlias}.proretset,
    'return_type_identity',${returnNamespaceAlias}.nspname || '.' || ${returnTypeAlias}.typname,
    'config',coalesce(${functionAlias}.proconfig,'{}'::text[]),
    'acl',coalesce((select jsonb_agg(jsonb_build_object(
      'grantee',case ${aclAlias}.grantee when 0 then 'PUBLIC' else ${aclGranteeAlias}.rolname end,
      'privilege',${aclAlias}.privilege_type,'grantable',${aclAlias}.is_grantable
    ) order by (case ${aclAlias}.grantee when 0 then 'PUBLIC' else ${aclGranteeAlias}.rolname end) collate "C",
      ${aclAlias}.privilege_type collate "C")
      from aclexplode(coalesce(${functionAlias}.proacl,acldefault('f',${functionAlias}.proowner))) ${aclAlias}
      left join pg_roles ${aclGranteeAlias} on ${aclGranteeAlias}.oid=${aclAlias}.grantee),'[]'::jsonb)
  )`;

function normalizeCatalogTriggers(rows = []) {
  return [...rows].map((trigger) => ({
    triggerName: String(trigger.trigger_name),
    definition: String(trigger.definition),
    enabled: String(trigger.enabled),
    deferrable: trigger.deferrable === true,
    initiallyDeferred: trigger.initially_deferred === true,
    functionIdentity: String(trigger.function_identity),
    functionCatalog: normalizeTriggerFunctionCatalog(trigger.function_catalog ?? trigger.functionCatalog),
  })).sort((left, right) => lexicalCompare(left.triggerName, right.triggerName));
}

export function canonicalBootstrapObjectCatalog(rows) {
  const objects = rows.map((row) => ({
    schemaName: String(row.schema_name),
    relationName: String(row.relation_name),
    ...normalizeRelationStructure(row),
    triggers: normalizeCatalogTriggers(row.triggers),
  })).sort((left, right) => lexicalCompare(`${left.schemaName}.${left.relationName}`, `${right.schemaName}.${right.relationName}`));
  return JSON.stringify({ contractVersion: "ai-content-bootstrap-object-catalog.v7", objects });
}

export function hashBootstrapObjectCatalog(rows) {
  return checksum(canonicalBootstrapObjectCatalog(rows));
}

export function validateBootstrapRoleSafety({
  roles: rows, membershipEdges, databaseSettings, database, publicSchema, session,
}, names, { afterSetRole = false } = {}) {
  if (!Array.isArray(rows) || !Array.isArray(membershipEdges)
    || !Array.isArray(databaseSettings) || !database || !publicSchema || !session) {
    throw new Error("bootstrap_role_catalog_invalid");
  }
  const byName = new Map(rows.map((row) => [String(row.role_name), row]));
  const exactNames = [names.schemaOwnerRoleName, names.applicationRoleName, names.operatorRoleName,
    names.migrationRoleName, names.cleanupRoleName];
  const controlledNames = new Set(exactNames);
  const providerOwnerRoleName = names.providerOwnerRoleName ?? "postgres";
  if (rows.length !== 5 || byName.size !== 5 || exactNames.some((name) => !byName.has(name))) throw new Error("bootstrap_role_catalog_invalid");
  const booleanRoleFields = ["can_login", "is_superuser", "bypass_rls", "can_create_db", "can_create_role", "can_replicate", "inherit"];
  const publicFirstRoles = new Set([names.schemaOwnerRoleName, names.migrationRoleName]);
  if (rows.some((row) => booleanRoleFields.some((field) => typeof row[field] !== "boolean")
    || !Array.isArray(row.config) || row.config.length !== 1
    || String(row.config[0]).replace(/\s+/g, "") !== (publicFirstRoles.has(String(row.role_name))
      ? "search_path=public,pg_catalog,pg_temp"
      : "search_path=pg_catalog,public,pg_temp")
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
  const expectedMembershipEdge = {
    member_role_name: names.migrationRoleName,
    parent_role_name: names.schemaOwnerRoleName,
    set_option: true,
    inherit_option: false,
    admin_option: false,
  };
  const normalizeEdge = (row) => ({
    member_role_name: String(row.member_role_name), parent_role_name: String(row.parent_role_name),
    set_option: row.set_option === true, inherit_option: row.inherit_option === true,
    admin_option: row.admin_option === true,
  });
  const edges = membershipEdges.map(normalizeEdge).filter((edge) => (
    controlledNames.has(edge.member_role_name) || controlledNames.has(edge.parent_role_name)
  )).sort((left, right) => lexicalCompare(
    `${left.member_role_name}\0${left.parent_role_name}`,
    `${right.member_role_name}\0${right.parent_role_name}`,
  ));
  const internalEdges = edges.filter((edge) => edge.member_role_name !== providerOwnerRoleName);
  const providerEdges = edges.filter((edge) => edge.member_role_name === providerOwnerRoleName);
  if (JSON.stringify(internalEdges) !== JSON.stringify([expectedMembershipEdge])
    || providerEdges.some((edge) => !controlledNames.has(edge.parent_role_name)
      || edge.set_option || edge.inherit_option || !edge.admin_option)
    || new Set(providerEdges.map((edge) => edge.parent_role_name)).size !== providerEdges.length) {
    throw new Error("bootstrap_role_catalog_invalid");
  }
  if (databaseSettings.some((row) => row.role_name != null
    || row.database_name !== database.database_name
    || !Array.isArray(row.settings) || row.settings.length === 0
    || row.settings.some((setting) => !/^app\.settings\.jwt_exp=[0-9]+$/.test(String(setting).replace(/\s+/g, ""))))) {
    throw new Error("bootstrap_role_database_settings_invalid");
  }
  if (database.owner_role_name !== providerOwnerRoleName
    || publicSchema.owner_role_name !== "pg_database_owner") {
    throw new Error("bootstrap_role_database_boundary_invalid");
  }
  const expectedSchemaAcl = normalizeAcl([
    { grantee: "pg_database_owner", privilege: "CREATE", grantable: false },
    { grantee: "pg_database_owner", privilege: "USAGE", grantable: false },
    { grantee: names.schemaOwnerRoleName, privilege: "CREATE", grantable: false },
    { grantee: names.schemaOwnerRoleName, privilege: "USAGE", grantable: false },
    ...[names.applicationRoleName, names.operatorRoleName, names.migrationRoleName, names.cleanupRoleName]
      .map((grantee) => ({ grantee, privilege: "USAGE", grantable: false })),
  ]);
  if (!Array.isArray(publicSchema.acl)) throw new Error("bootstrap_role_public_schema_acl_invalid");
  const actualSchemaAcl = normalizeAcl(publicSchema.acl);
  const expectedSchemaAclNormalized = normalizeAcl(expectedSchemaAcl);
  const expectedSchemaAclKeys = new Set(expectedSchemaAclNormalized.map((entry) => JSON.stringify(entry)));
  const actualSchemaAclKeys = new Set(actualSchemaAcl.map((entry) => JSON.stringify(entry)));
  if (expectedSchemaAclNormalized.some((entry) => !actualSchemaAclKeys.has(JSON.stringify(entry)))
    || actualSchemaAcl.some((entry) => !expectedSchemaAclKeys.has(JSON.stringify(entry))
      && (entry.privilege !== "USAGE" || entry.grantable !== false
        || controlledNames.has(entry.grantee)))) {
    throw new Error("bootstrap_role_public_schema_acl_invalid");
  }
  const expectedCurrentRole = afterSetRole ? names.schemaOwnerRoleName : names.migrationRoleName;
  if (session.session_user_name !== names.migrationRoleName
    || session.current_user_name !== expectedCurrentRole
    || String(session.effective_search_path).replace(/\s+/g, "") !== "public,pg_catalog,pg_temp") {
    throw new Error("bootstrap_role_session_environment_invalid");
  }
  return true;
}

export function canonicalEventTriggerDefinition(value) {
  return JSON.stringify({
    contractVersion: "ai-content-074-event-trigger-definition.v2",
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
    definition: String(row.definition),
  })).sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  const controlTriggers = [...(value.controlTriggers ?? [])].map((row) => ({
    relationName: String(row.relation_name ?? row.relationName),
    triggerName: String(row.trigger_name ?? row.triggerName),
    triggerType: Number(row.trigger_type ?? row.triggerType),
    functionIdentity: String(row.function_identity ?? row.functionIdentity),
    enabled: String(row.enabled),
    deferrable: (row.deferrable ?? row.tgdeferrable) === true,
    initiallyDeferred: (row.initially_deferred ?? row.initiallyDeferred ?? row.tginitdeferred) === true,
    definition: String(row.definition),
  })).sort((left, right) => lexicalCompare(`${left.relationName}|${left.triggerName}`, `${right.relationName}|${right.triggerName}`));
  const fenceCatalog = [...(value.fenceCatalog ?? [])].map((row) => ({
    relationName: String(row.relation_name ?? row.relationName),
    relationClass: String(row.relation_class ?? row.relationClass),
    rowClassifier: String(row.row_classifier ?? row.rowClassifier),
  })).sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  const controlRelations = [...(value.controlRelations ?? [])].map((row) => ({
    relationName: String(row.relation_name ?? row.relationName),
    ...normalizeRelationStructure(row),
  })).sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  return JSON.stringify({ contractVersion: "ai-content-074-fence-security-catalog.v5", functions, ordinaryTriggers, controlTriggers, fenceCatalog, controlRelations });
}

export function hashFenceSecurityCatalog(value) {
  return checksum(canonicalFenceSecurityCatalog(value));
}

export function canonicalFenceSecurityStableCore(value) {
  const fullCatalog = JSON.parse(canonicalFenceSecurityCatalog(value));
  const controlRelations = fullCatalog.controlRelations.map((relation) => {
    const { internalConstraintTriggers: _legitimatePostCutoverFkTriggers, ...stableRelation } = relation;
    return stableRelation;
  });
  return JSON.stringify({
    ...fullCatalog,
    contractVersion: "ai-content-074-fence-security-stable-core.v1",
    controlRelations,
  });
}

export function hashFenceSecurityStableCore(value) {
  return checksum(canonicalFenceSecurityStableCore(value));
}

export function canonicalPost075ProtectedObjectCatalog({ bootstrapObjectRows, controlRelations }) {
  const controlStructures = [...(controlRelations ?? [])].map((row) => ({
    relationName: String(row.relation_name ?? row.relationName),
    ...normalizeRelationStructure(row),
  })).sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  const expectedControlRelations = [...providerEnforcementBundle.controlRelations].sort(lexicalCompare);
  if (exactJson(controlStructures.map(({ relationName }) => relationName)) !== exactJson(expectedControlRelations)) {
    throw new Error("cutover_075_post_control_structure_catalog_invalid");
  }
  return JSON.stringify({
    contractVersion: "ai-content-075-protected-object-catalog.v1",
    bootstrapObjectCatalog: JSON.parse(canonicalBootstrapObjectCatalog(bootstrapObjectRows ?? [])),
    controlStructures,
  });
}

export function hashPost075ProtectedObjectCatalog(value) {
  return checksum(canonicalPost075ProtectedObjectCatalog(value));
}

const fenceSecurityCatalogKeys = Object.freeze(["contractVersion", "functions", "ordinaryTriggers", "controlTriggers", "fenceCatalog", "controlRelations"]);
const fenceSecurityFunctionKeys = Object.freeze(["identity", "definitionSha256", "ownerRoleName", "securityDefiner", "config", "acl"]);
const fenceSecurityTriggerKeys = Object.freeze(["relationName", "triggerName", "triggerType", "functionIdentity", "enabled", "definition"]);
const fenceSecurityControlTriggerKeys = Object.freeze(["relationName", "triggerName", "triggerType", "functionIdentity", "enabled", "deferrable", "initiallyDeferred", "definition"]);
const fenceSecurityFenceKeys = Object.freeze(["relationName", "relationClass", "rowClassifier"]);
const fenceSecurityControlKeys = Object.freeze(["relationName", "relationKind", "relationPersistence", "replicaIdentity", "isPartition", "partitionBound", "inheritanceParents", "internalConstraintTriggers", "rowSecurity", "forceRowSecurity", "ownerRoleName", "acl", "columns", "constraints", "indexes", "rules", "policies"]);
const aclKeys = Object.freeze(["grantee", "privilege", "grantable"]);
const relationColumnKeys = Object.freeze(["ordinalPosition", "columnName", "typeIdentity", "collationIdentity", "notNull", "defaultDefinition", "identityKind", "generatedKind", "acl"]);
const relationConstraintKeys = Object.freeze(["constraintName", "constraintType", "definition", "validated", "deferrable", "initiallyDeferred"]);
const relationIndexKeys = Object.freeze(["indexName", "definition", "primary", "unique", "valid", "ready", "live"]);
const relationRuleKeys = Object.freeze(["ruleName", "event", "enabled", "instead", "definition"]);
const relationPolicyKeys = Object.freeze(["policyName", "permissive", "roles", "command", "qual", "withCheck"]);
const relationInternalConstraintTriggerKeys = Object.freeze(["constraintIdentity", "triggerName", "triggerType", "enabled", "deferrable", "initiallyDeferred", "functionIdentity", "definition"]);

function validateStoredFenceSecurityCatalog(value, expectedSha256, errorCode = "bootstrap_074_fence_security_catalog_mismatch") {
  assertExactObjectKeys(value, fenceSecurityCatalogKeys, errorCode);
  if (value.contractVersion !== "ai-content-074-fence-security-catalog.v5"
    || !Array.isArray(value.functions) || !Array.isArray(value.ordinaryTriggers)
    || !Array.isArray(value.controlTriggers)
    || !Array.isArray(value.fenceCatalog) || !Array.isArray(value.controlRelations)) throw new Error(errorCode);
  for (const row of value.functions) {
    assertExactObjectKeys(row, fenceSecurityFunctionKeys, errorCode);
    if (!Array.isArray(row.config) || !Array.isArray(row.acl)) throw new Error(errorCode);
    row.acl.forEach((acl) => assertExactObjectKeys(acl, aclKeys, errorCode));
  }
  for (const row of value.ordinaryTriggers) assertExactObjectKeys(row, fenceSecurityTriggerKeys, errorCode);
  for (const row of value.controlTriggers) assertExactObjectKeys(row, fenceSecurityControlTriggerKeys, errorCode);
  for (const row of value.fenceCatalog) assertExactObjectKeys(row, fenceSecurityFenceKeys, errorCode);
  for (const row of value.controlRelations) {
    assertExactObjectKeys(row, fenceSecurityControlKeys, errorCode);
    if (!Array.isArray(row.inheritanceParents) || !Array.isArray(row.internalConstraintTriggers)
      || !Array.isArray(row.acl) || !Array.isArray(row.columns) || !Array.isArray(row.constraints)
      || !Array.isArray(row.indexes) || !Array.isArray(row.rules) || !Array.isArray(row.policies)) throw new Error(errorCode);
    row.internalConstraintTriggers.forEach((trigger) => {
      assertExactObjectKeys(trigger, relationInternalConstraintTriggerKeys, errorCode);
    });
    row.acl.forEach((acl) => assertExactObjectKeys(acl, aclKeys, errorCode));
    row.columns.forEach((column) => {
      assertExactObjectKeys(column, relationColumnKeys, errorCode);
      if (!Array.isArray(column.acl)) throw new Error(errorCode);
      column.acl.forEach((acl) => assertExactObjectKeys(acl, aclKeys, errorCode));
    });
    row.constraints.forEach((constraint) => assertExactObjectKeys(constraint, relationConstraintKeys, errorCode));
    row.indexes.forEach((index) => assertExactObjectKeys(index, relationIndexKeys, errorCode));
    row.rules.forEach((rule) => assertExactObjectKeys(rule, relationRuleKeys, errorCode));
    row.policies.forEach((policy) => {
      assertExactObjectKeys(policy, relationPolicyKeys, errorCode);
      if (!Array.isArray(policy.roles)) throw new Error(errorCode);
    });
  }
  const canonicalJson = canonicalFenceSecurityCatalog(value);
  const projectAcl = (acl) => acl.map((item) => Object.fromEntries(aclKeys.map((key) => [key, item[key]])));
  const projectRelation = (row) => ({
    ...Object.fromEntries(fenceSecurityControlKeys.map((key) => [key, row[key]])),
    inheritanceParents: [...row.inheritanceParents],
    internalConstraintTriggers: row.internalConstraintTriggers.map((trigger) => Object.fromEntries(
      relationInternalConstraintTriggerKeys.map((key) => [key, trigger[key]]),
    )),
    acl: projectAcl(row.acl),
    columns: row.columns.map((column) => ({
      ...Object.fromEntries(relationColumnKeys.map((key) => [key, column[key]])),
      acl: projectAcl(column.acl),
    })),
    constraints: row.constraints.map((constraint) => Object.fromEntries(
      relationConstraintKeys.map((key) => [key, constraint[key]]),
    )),
    indexes: row.indexes.map((index) => Object.fromEntries(
      relationIndexKeys.map((key) => [key, index[key]]),
    )),
    rules: row.rules.map((rule) => Object.fromEntries(
      relationRuleKeys.map((key) => [key, rule[key]]),
    )),
    policies: row.policies.map((policy) => Object.fromEntries(
      relationPolicyKeys.map((key) => [key, policy[key]]),
    )),
  });
  const exactProjection = {
    contractVersion: value.contractVersion,
    functions: value.functions.map((row) => ({ ...Object.fromEntries(fenceSecurityFunctionKeys.map((key) => [key, row[key]])), acl: projectAcl(row.acl) })),
    ordinaryTriggers: value.ordinaryTriggers.map((row) => Object.fromEntries(fenceSecurityTriggerKeys.map((key) => [key, row[key]]))),
    controlTriggers: value.controlTriggers.map((row) => Object.fromEntries(fenceSecurityControlTriggerKeys.map((key) => [key, row[key]]))),
    fenceCatalog: value.fenceCatalog.map((row) => Object.fromEntries(fenceSecurityFenceKeys.map((key) => [key, row[key]]))),
    controlRelations: value.controlRelations.map(projectRelation),
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
    functions: interim.functions.map((row) => ({
      ...row,
      ownerRoleName: "postgres",
      acl: normalizeAcl([
        ...replaceOwnerAcl(row.acl),
        ...(row.identity === "public.register_ai_content_075_fence_relations()"
          ? [{ grantee: schemaOwnerRoleName, privilege: "EXECUTE", grantable: false }]
          : []),
      ]),
    })),
    controlRelations: interim.controlRelations.map((row) => ({
      ...row,
      ownerRoleName: "postgres",
      acl: normalizeAcl([
        ...replaceOwnerAcl(row.acl),
        ...(row.relationName === "ai_content_cutovers"
          ? [{ grantee: schemaOwnerRoleName, privilege: "REFERENCES", grantable: false }]
          : []),
        ...(row.relationName === "ai_content_bootstrap_state"
          ? [{ grantee: schemaOwnerRoleName, privilege: "SELECT", grantable: false }]
          : []),
      ]),
    })),
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
    functionCatalog: normalizeFunctionCatalog(row.function_catalog ?? row.functionCatalog),
  })).sort((left, right) => lexicalCompare(left.eventTriggerName, right.eventTriggerName));
  return JSON.stringify({ contractVersion: "ai-content-event-trigger-catalog.v2", eventTriggers });
}

const eventTriggerCatalogEnvelopeKeys = Object.freeze(["contractVersion", "eventTriggers"]);
const eventTriggerCatalogRowKeys = Object.freeze(["eventTriggerName", "eventTriggerEvent", "eventTriggerTags",
  "eventTriggerEnabled", "eventTriggerOwner", "eventTriggerFunction", "eventTriggerFunctionSha256",
  "functionCatalog"]);
const eventTriggerFunctionCatalogKeys = Object.freeze(["identity", "definitionSha256", "sourceSha256",
  "ownerRoleName", "securityDefiner", "languageName", "functionKind", "volatility", "parallelSafety",
  "leakproof", "strict", "returnSet", "returnTypeIdentity", "config", "acl"]);

function validateStoredEventTriggerCatalogEnvelope(value, expectedSha256, expectedCount) {
  const errorCode = "bootstrap_074_event_trigger_baseline_invalid";
  assertExactObjectKeys(value, eventTriggerCatalogEnvelopeKeys, errorCode);
  if (value.contractVersion !== "ai-content-event-trigger-catalog.v2" || !Array.isArray(value.eventTriggers)) {
    throw new Error(errorCode);
  }
  for (const row of value.eventTriggers) {
    assertExactObjectKeys(row, eventTriggerCatalogRowKeys, errorCode);
    assertExactObjectKeys(row.functionCatalog, eventTriggerFunctionCatalogKeys, errorCode);
    if (!Array.isArray(row.eventTriggerTags) || !Array.isArray(row.functionCatalog.config)
      || !Array.isArray(row.functionCatalog.acl)) throw new Error(errorCode);
    row.functionCatalog.acl.forEach((acl) => assertExactObjectKeys(acl, aclKeys, errorCode));
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
    `/* full_event_trigger_catalog_v2 */
     select event_trigger.evtname as event_trigger_name,event_trigger.evtevent as event_trigger_event,
            coalesce(event_trigger.evttags,'{}'::text[]) as event_trigger_tags,
            case event_trigger.evtenabled when 'O' then 'enabled' else event_trigger.evtenabled::text end as event_trigger_enabled,
            owner.rolname as event_trigger_owner,
            namespace.nspname || '.' || function.proname as event_trigger_function,
            encode(sha256(convert_to(pg_get_functiondef(function.oid),'UTF8')),'hex') as event_trigger_function_sha256,
            ${functionCatalogJsonSql({
              functionAlias: "function", namespaceAlias: "namespace", ownerAlias: "function_owner",
              languageAlias: "function_language", returnTypeAlias: "function_return_type",
              returnNamespaceAlias: "function_return_namespace", aclAlias: "function_acl",
              aclGranteeAlias: "function_acl_grantee",
            })} as function_catalog
       from pg_event_trigger event_trigger
       join pg_roles owner on owner.oid=event_trigger.evtowner
       join pg_proc function on function.oid=event_trigger.evtfoid
       join pg_namespace namespace on namespace.oid=function.pronamespace
       join pg_roles function_owner on function_owner.oid=function.proowner
       join pg_language function_language on function_language.oid=function.prolang
       join pg_type function_return_type on function_return_type.oid=function.prorettype
       join pg_namespace function_return_namespace on function_return_namespace.oid=function_return_type.typnamespace
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
  if (before?.contractVersion !== "ai-content-event-trigger-catalog.v2" || !Array.isArray(before.eventTriggers)
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
    function_catalog: added[0]?.functionCatalog,
  }])).eventTriggers[0];
  const addedFunction = added[0]?.functionCatalog;
  const expectedFunctionAcl = normalizeAcl([{ grantee: "postgres", privilege: "EXECUTE", grantable: false }]);
  if (!addedFunction || addedFunction.identity !== `${authorization.eventTriggerFunction}()`
    || addedFunction.definitionSha256 !== authorization.eventTriggerFunctionSha256
    || addedFunction.ownerRoleName !== authorization.eventTriggerOwner
    || addedFunction.securityDefiner !== true
    || exactJson(addedFunction.config) !== exactJson(["search_path=pg_catalog,public"])
    || exactJson(addedFunction.acl) !== exactJson(expectedFunctionAcl)) {
    throw new Error("bootstrap_074_event_trigger_function_catalog_invalid");
  }
  if (exactJson(added[0]) !== exactJson(expected)) throw new Error("bootstrap_074_event_trigger_delta_invalid");
  return { catalogSha256: hashEventTriggerCatalog(afterRows), count: after.eventTriggers.length };
}

const fenceSecurityFunctions = Object.freeze([
  { identity: "public.ai_content_075_acl_catalog(text,text,text,text)", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.ai_content_cutover_bypass_allowed()", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration" },
  { identity: "public.ai_content_fence_trigger_name(text)", securityDefiner: false, config: ["search_path=pg_catalog"] },
  { identity: "public.assert_ai_content_writable()", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "application" },
  { identity: "public.apply_ai_content_075_acl_command(text,text,text,text)", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.consume_ai_content_provider_attestation()", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration" },
  { identity: "public.enforce_ai_content_075_registration_seal_cleared()", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.enforce_ai_content_ddl_allowlist()", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.enforce_ai_content_write_fence()", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.forbid_ai_content_cutover_event_mutation()", securityDefiner: false, config: ["search_path=pg_catalog,public"] },
  { identity: "public.lock_ai_content_cutover_transaction_state(uuid)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration" },
  { identity: "public.prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamp with time zone,text,text,jsonb,text,text,text,text)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "operator" },
  { identity: "public.read_ai_content_cutover_control_state(uuid)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "operator" },
  { identity: "public.read_ai_content_cutover_migration_body_evidence(uuid)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration" },
  { identity: "public.register_ai_content_075_fence_relations()", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration", executeAlso: "schemaOwner" },
  { identity: "public.set_ai_content_maintenance(uuid,boolean)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "operator" },
  { identity: "public.transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamp with time zone,text,text)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "operator", executeAlso: "migration" },
  { identity: "public.verify_ai_content_cutover_preflight_identity(uuid,jsonb,text,text)", securityDefiner: true, config: ["search_path=pg_catalog,public"], execute: "migration" },
  { identity: "public.verify_ai_content_cutover_status_chain(uuid)", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.verify_ai_content_cutover_status_chain_locked(ai_content_cutovers)", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
  { identity: "public.verify_ai_content_075_acl_final_catalog()", securityDefiner: true, config: ["search_path=pg_catalog,public"] },
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
const tableOwnerPrivileges = Object.freeze(["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]);

export const cutover075RelationSecurityCatalog = Object.freeze([
  { relationName: "ai_content_cutover_release_adoption_events", owner: "provider", grants: [{ role: "operator", privileges: ["SELECT"] }] },
  { relationName: "ai_content_cutover_release_adoptions", owner: "provider", grants: [{ role: "operator", privileges: ["SELECT"] }] },
  { relationName: "ai_content_generation_operations", owner: "schemaOwner", grants: [{ role: "application", privileges: ["INSERT", "SELECT", "UPDATE"] }] },
  { relationName: "ai_content_generation_prompt_bindings", owner: "schemaOwner", grants: [{ role: "application", privileges: ["SELECT"] }] },
  { relationName: "ai_content_proposal_attempt_events", owner: "schemaOwner", grants: [{ role: "application", privileges: ["SELECT"] }] },
  { relationName: "ai_content_proposal_compositions", owner: "schemaOwner", grants: [{ role: "application", privileges: ["INSERT", "SELECT"] }] },
  { relationName: "ai_content_proposal_job_contracts", owner: "schemaOwner", grants: [{ role: "application", privileges: ["INSERT", "SELECT"] }] },
  { relationName: "ai_content_proposal_model_attempts", owner: "schemaOwner", grants: [{ role: "application", privileges: ["INSERT", "SELECT", "UPDATE"] }] },
  { relationName: "ai_content_proposal_performance_audits", owner: "schemaOwner", grants: [{ role: "application", privileges: ["INSERT", "SELECT"] }] },
  { relationName: "ai_content_proposal_research_attempt_events", owner: "schemaOwner", grants: [{ role: "application", privileges: ["SELECT"] }] },
  { relationName: "ai_content_proposal_research_attempts", owner: "schemaOwner", grants: [{ role: "application", privileges: ["INSERT", "SELECT", "UPDATE"] }] },
  { relationName: "ai_content_storage_cleanup_outbox", owner: "provider", grants: [{ role: "cleanup", privileges: ["SELECT"] }] },
  { relationName: "automated_content_proposal_runs", owner: "schemaOwner", grants: [{ role: "application", privileges: ["INSERT", "SELECT"] }] },
].map(Object.freeze));

const post075Function = (identity, {
  securityDefiner = true, owner = "schemaOwner", execute = [], returnType = "pg_catalog.trigger", returnSet = false,
  language = "plpgsql", volatility = "v", strict = false, config = ["search_path=pg_catalog,public,pg_temp"],
} = {}) => Object.freeze({
  identity, securityDefiner, owner, execute: Object.freeze(execute),
  language, kind: "f", volatility, parallel: "u", leakproof: false, strict,
  returnType, returnSet,
  config: Object.freeze(config),
});
export const cutover075SecurityFunctions = Object.freeze([
  post075Function("public.reject_ai_content_cutover_record_mutation()", { securityDefiner: false, owner: "provider" }),
  post075Function("public.enforce_ai_content_generation_operation_identity()"),
  post075Function("public.require_ai_content_generation_operation_on_insert()", { securityDefiner: false }),
  post075Function("public.freeze_ai_content_generation_operation_identity()", { securityDefiner: false }),
  post075Function("public.transition_ai_content_generation_operation(uuid,text,text)", {
    execute: ["application"], returnType: "public.ai_content_generation_operations",
  }),
  post075Function("public.freeze_automated_content_proposal_run_identity()", { securityDefiner: false }),
  post075Function("public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)", { execute: ["application"], returnType: "public.automated_content_proposal_runs" }),
  post075Function("public.enforce_ai_content_proposal_research_attempt_contract()"),
  post075Function("public.enforce_ai_content_proposal_composition_research_success()"),
  post075Function("public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)", { execute: ["application"], returnType: "pg_catalog.text" }),
  post075Function("public.enforce_ai_content_proposal_research_completion_pair()"),
  post075Function("public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)", {
    execute: ["application"], returnType: "public.ai_content_proposal_compositions",
  }),
  post075Function("public.enforce_ai_content_proposal_model_attempt_contract()"),
  post075Function("public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)", { execute: ["application"], returnType: "pg_catalog.text" }),
  post075Function("public.select_ai_content_proposal(uuid,uuid,uuid,uuid)", {
    securityDefiner: false, execute: ["application"], returnType: "pg_catalog.uuid",
  }),
  post075Function("public.enforce_ai_content_proposal_success_event()"),
  post075Function("public.enforce_ai_content_prompt_binding_source()"),
  post075Function("public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)", {
    execute: ["application"], returnType: "pg_catalog.uuid",
  }),
  post075Function("public.freeze_topic_upload_operation_identity()", { securityDefiner: false }),
  post075Function("public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)", { execute: ["application"], returnType: "pg_catalog.record", returnSet: true }),
  post075Function("public.enforce_ai_content_usage_reversal_identity()", { securityDefiner: false }),
  post075Function("public.reject_ai_content_usage_ledger_mutation()"),
  post075Function("public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)", { owner: "provider", execute: ["operator"], returnType: "pg_catalog.record", returnSet: true }),
  post075Function("public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)", { owner: "provider", execute: ["operator"], returnType: "pg_catalog.text" }),
  post075Function("public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)", { owner: "provider", execute: ["cleanup"], returnType: "public.ai_content_storage_cleanup_outbox", returnSet: true }),
  post075Function("public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)", { owner: "provider", execute: ["cleanup"], returnType: "public.ai_content_storage_cleanup_outbox" }),
  post075Function("public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)", { owner: "provider", execute: ["cleanup"], returnType: "public.ai_content_storage_cleanup_outbox" }),
  post075Function("public.is_ai_content_storage_path_protected(uuid,text)", { owner: "provider", execute: ["application"], returnType: "pg_catalog.bool" }),
  post075Function("public.lock_ai_content_fixed_input_sources(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[])", {
    owner: "provider", execute: ["application"], returnType: "pg_catalog.bool",
    config: ["search_path=pg_catalog,public"],
  }),
  post075Function("public.ai_content_generation_input_v3_is_valid(jsonb)", {
    securityDefiner: false, execute: ["application"], language: "sql", volatility: "i", returnType: "pg_catalog.bool",
  }),
  post075Function("public.ai_content_plan_v2_is_valid(jsonb)", {
    securityDefiner: false, execute: ["application"], language: "sql", volatility: "i", returnType: "pg_catalog.bool",
  }),
  post075Function("public.ai_content_manifest_v3_is_valid(jsonb)", {
    securityDefiner: false, execute: ["application"], language: "sql", volatility: "i", returnType: "pg_catalog.bool",
  }),
  post075Function("public.enforce_ai_content_three_format_identity()", { securityDefiner: false }),
  post075Function("public.ai_content_cutover_storage_value_to_path(text)", {
    securityDefiner: false, volatility: "i", strict: true, returnType: "pg_catalog.text",
  }),
  post075Function("public.ai_content_cutover_storage_candidates()", {
    securityDefiner: false, language: "sql", volatility: "s", returnType: "pg_catalog.record", returnSet: true,
  }),
  post075Function("public.ai_content_cutover_target_ids()", {
    securityDefiner: false, language: "sql", volatility: "s", returnType: "pg_catalog.uuid", returnSet: true,
  }),
  post075Function("public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)", {
    securityDefiner: false, returnType: "pg_catalog.uuid",
  }),
]);

const pgCatalogQualifiedFunctionIdentity = (identity) => identity.replace(
  /\b(uuid|text|jsonb)\b/g,
  "pg_catalog.$1",
);
export const cutover075OwnerAuthorizationRows = Object.freeze([
  ...cutover075SecurityFunctions.filter(({ owner }) => owner === "provider").map(({ identity }) => Object.freeze({
    commandTag: "ALTER FUNCTION", objectIdentityPattern: pgCatalogQualifiedFunctionIdentity(identity),
  })),
  ...cutover075RelationSecurityCatalog.filter(({ owner }) => owner === "provider").map(({ relationName }) => Object.freeze({
    commandTag: "ALTER TABLE", objectIdentityPattern: `public.${relationName}`,
  })),
].sort((left, right) => lexicalCompare(
  `${left.commandTag}\0${left.objectIdentityPattern}`,
  `${right.commandTag}\0${right.objectIdentityPattern}`,
)));

export function buildCutover075FunctionSourceHashes(migration) {
  if (migration?.id !== cutover075MigrationId || typeof migration.sql !== "string"
    || !exactHex(migration.checksum, 64) || checksum(migration.sql) !== migration.checksum) {
    throw new Error("cutover_075_function_source_migration_invalid");
  }
  const { sql } = migration;
  return Object.fromEntries(cutover075SecurityFunctions.map(({ identity }) => {
    const functionName = identity.slice("public.".length, identity.indexOf("("));
    const starts = [
      sql.indexOf(`create function ${functionName}(`),
      sql.indexOf(`create function public.${functionName}(`),
      sql.indexOf(`create or replace function ${functionName}(`),
      sql.indexOf(`create or replace function public.${functionName}(`),
    ].filter((index) => index >= 0);
    const start = starts.length > 0 ? Math.min(...starts) : -1;
    const end = start < 0 ? -1 : sql.indexOf("\ncreate function ", start + 1);
    const definition = start < 0 ? "" : sql.slice(start, end < 0 ? sql.length : end);
    const body = definition.match(/\bas \$\$([\s\S]*?)\$\$;/i)?.[1];
    if (body == null) throw new Error(`cutover_075_function_source_missing:${identity}`);
    return [identity, checksum(body)];
  }));
}

const post075TriggerEvents = Object.freeze({
  5: "AFTER INSERT",
  7: "BEFORE INSERT",
  19: "BEFORE UPDATE",
  21: "AFTER INSERT OR UPDATE",
  23: "BEFORE INSERT OR UPDATE",
  27: "BEFORE DELETE OR UPDATE",
});
const post075Trigger = (relationName, triggerName, triggerType, functionIdentity, deferrable = false, updateColumns = []) => {
  const events = post075TriggerEvents[triggerType];
  if (events === undefined || (deferrable && ![5, 21].includes(triggerType))) {
    throw new Error("cutover_075_expected_trigger_invalid");
  }
  const updateClause = updateColumns.length > 0 ? ` OF ${updateColumns.join(", ")}` : "";
  const definition = `CREATE ${deferrable ? "CONSTRAINT " : ""}TRIGGER ${triggerName} ${events}${updateClause} ON ${relationName}${deferrable ? " DEFERRABLE INITIALLY DEFERRED" : ""} FOR EACH ROW EXECUTE FUNCTION ${functionIdentity.replace(/^public\./, "")}`;
  return Object.freeze({
    relationName, triggerName, triggerType, functionIdentity, enabled: "O",
    deferrable, initiallyDeferred: deferrable, updateColumns: Object.freeze(updateColumns), whenClause: null,
    definition,
  });
};
export const cutover075DomainTriggers = Object.freeze([
  post075Trigger("ai_content_generations", "ai_content_generations_operation_required", 23, "public.require_ai_content_generation_operation_on_insert()", false,
    ["operation_id", "status", "current_stage", "generation_idempotency_key", "generation_input_snapshot", "error_code", "error_message", "completed_at"]),
  post075Trigger("ai_content_generations", "ai_content_generations_operation_identity", 21, "public.enforce_ai_content_generation_operation_identity()", true,
    ["operation_id", "parent_generation_id", "workspace_id", "brand_id"]),
  post075Trigger("ai_content_generation_operations", "ai_content_generation_operations_identity_immutable", 19, "public.freeze_ai_content_generation_operation_identity()", false,
    ["workspace_id", "brand_id", "operation_key", "request_fingerprint_sha256", "parent_operation_id", "generation_id"]),
  post075Trigger("ai_content_generation_operations", "ai_content_generation_operations_initial_state", 7, "public.reject_ai_content_cutover_record_mutation()"),
  post075Trigger("ai_content_generation_operations", "ai_content_generation_operations_generation_identity", 21, "public.enforce_ai_content_generation_operation_identity()", true,
    ["generation_id", "parent_operation_id", "workspace_id", "brand_id"]),
  post075Trigger("automated_content_proposal_runs", "automated_content_proposal_runs_identity_immutable", 19, "public.freeze_automated_content_proposal_run_identity()", false,
    ["workspace_id", "brand_id", "caller_operation_key", "request_fingerprint_sha256", "caller_transaction_id", "frozen_source_snapshot_ids", "proposal_batch_id"]),
  post075Trigger("automated_content_proposal_runs", "automated_content_proposal_runs_initial_state", 7, "public.reject_ai_content_cutover_record_mutation()"),
  post075Trigger("ai_content_proposal_jobs", "ai_content_proposal_jobs_contract_required", 5, "public.reject_ai_content_cutover_record_mutation()", true),
  post075Trigger("ai_content_proposal_research_attempts", "ai_content_proposal_research_attempts_contract_guard", 7, "public.enforce_ai_content_proposal_research_attempt_contract()"),
  post075Trigger("ai_content_proposal_compositions", "ai_content_proposal_compositions_research_success", 21, "public.enforce_ai_content_proposal_composition_research_success()", true),
  post075Trigger("ai_content_proposal_research_attempt_events", "ai_content_proposal_research_attempt_events_completion_pair", 21,
    "public.enforce_ai_content_proposal_research_completion_pair()", true),
  post075Trigger("ai_content_proposal_model_attempts", "ai_content_proposal_model_attempts_contract_guard", 7, "public.enforce_ai_content_proposal_model_attempt_contract()"),
  post075Trigger("ai_content_proposals", "ai_content_proposals_success_event", 21, "public.enforce_ai_content_proposal_success_event()", true,
    ["status", "successful_model_attempt_id", "successful_proposal_job_id", "final_invocation_ordinal"]),
  post075Trigger("ai_content_proposal_jobs", "ai_content_proposal_jobs_invocation_reclaim_guard", 23,
    "public.reject_ai_content_cutover_record_mutation()"),
  post075Trigger("ai_content_proposal_jobs", "ai_content_proposal_jobs_invocation_evidence_guard", 21,
    "public.reject_ai_content_cutover_record_mutation()", true),
  post075Trigger("ai_content_generation_prompt_bindings", "ai_content_generation_prompt_bindings_source", 21, "public.enforce_ai_content_prompt_binding_source()", true),
  post075Trigger("ai_content_generation_prompt_bindings", "ai_content_generation_prompt_bindings_three_format_identity", 21,
    "public.enforce_ai_content_three_format_identity()", true, ["generation_id", "output_format", "purpose"]),
  post075Trigger("ai_content_generation_jobs", "ai_content_generation_jobs_three_format_identity", 21,
    "public.enforce_ai_content_three_format_identity()", true, ["generation_id", "output_format"]),
  post075Trigger("ai_content_generations", "ai_content_generations_three_format_identity", 21,
    "public.enforce_ai_content_three_format_identity()", true, ["output_format", "purpose", "generation_input_snapshot"]),
  post075Trigger("topic_uploads", "topic_uploads_operation_identity_immutable", 19, "public.freeze_topic_upload_operation_identity()", false,
    ["operation_key", "request_fingerprint"]),
  post075Trigger("ai_content_usage_ledger", "ai_content_usage_reversal_identity", 7, "public.enforce_ai_content_usage_reversal_identity()"),
  post075Trigger("ai_content_usage_ledger", "ai_content_usage_ledger_immutable", 27, "public.reject_ai_content_usage_ledger_mutation()"),
  ...[
    "ai_content_proposal_performance_audits", "ai_content_proposal_job_contracts",
    "ai_content_proposal_compositions", "ai_content_proposal_research_attempts",
    "ai_content_proposal_research_attempt_events", "ai_content_proposal_model_attempts",
    "ai_content_proposal_attempt_events", "ai_content_generation_prompt_bindings",
    "ai_content_cutover_release_adoptions", "ai_content_cutover_release_adoption_events",
  ].map((relationName) => post075Trigger(
    relationName, `${relationName}_immutable`, 27, "public.reject_ai_content_cutover_record_mutation()",
  )),
].sort((left, right) => lexicalCompare(`${left.relationName}|${left.triggerName}`, `${right.relationName}|${right.triggerName}`)));

function expectedAcl(owner, extra = []) {
  return normalizeAcl([{ grantee: owner, privilege: "EXECUTE", grantable: false }, ...extra]);
}

function exactJson(value) {
  return JSON.stringify(value);
}

function cutover075RoleName(names, ownerRoleName, key) {
  if (key === "provider") return ownerRoleName;
  const roleName = names[`${key}RoleName`];
  if (typeof roleName !== "string" || roleName.length === 0) throw new Error("cutover_075_post_catalog_role_invalid");
  return roleName;
}

export function validateCutover075PostCatalog(
  { functionRows, relationRows, triggerRows }, names, ownerRoleName = "postgres", sourceSha256ByIdentity = {},
) {
  const actualFunctions = [...(functionRows ?? [])].sort((left, right) => lexicalCompare(String(left.identity), String(right.identity)));
  const expectedFunctions = [...cutover075SecurityFunctions].sort((left, right) => lexicalCompare(left.identity, right.identity));
  if (actualFunctions.length !== expectedFunctions.length) throw new Error("cutover_075_post_function_catalog_mismatch");
  for (let index = 0; index < expectedFunctions.length; index += 1) {
    const expected = expectedFunctions[index];
    const actual = actualFunctions[index];
    const owner = cutover075RoleName(names, ownerRoleName, expected.owner);
    const extraAcl = expected.execute
      .map((key) => cutover075RoleName(names, ownerRoleName, key))
      .filter((grantee) => grantee !== owner)
      .map((grantee) => ({ grantee, privilege: "EXECUTE", grantable: false }));
    const config = [...(actual?.config ?? [])].map((item) => String(item).replace(/\s+/g, "")).sort(lexicalCompare);
    if (actual?.identity !== expected.identity || !exactHex(actual?.definition_sha256, 64)
      || !exactHex(sourceSha256ByIdentity[expected.identity], 64)
      || actual?.source_sha256 !== sourceSha256ByIdentity[expected.identity]
      || actual.owner_role_name !== owner || actual.security_definer !== expected.securityDefiner
      || actual.language_name !== expected.language || actual.function_kind !== expected.kind
      || actual.volatility !== expected.volatility || actual.parallel_safety !== expected.parallel
      || actual.leakproof !== expected.leakproof || actual.strict !== expected.strict
      || actual.return_set !== expected.returnSet || actual.return_type_identity !== expected.returnType
      || exactJson(config) !== exactJson(expected.config)
      || exactJson(normalizeAcl(actual?.acl)) !== exactJson(expectedAcl(owner, extraAcl))) {
      throw new Error(`cutover_075_post_function_catalog_mismatch:${expected.identity}`);
    }
  }

  const actualRelations = [...(relationRows ?? [])].sort((left, right) => lexicalCompare(String(left.relation_name), String(right.relation_name)));
  const expectedRelations = [...cutover075RelationSecurityCatalog].sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  if (actualRelations.length !== expectedRelations.length) throw new Error("cutover_075_post_relation_catalog_mismatch");
  for (let index = 0; index < expectedRelations.length; index += 1) {
    const expected = expectedRelations[index];
    const actual = actualRelations[index];
    const owner = cutover075RoleName(names, ownerRoleName, expected.owner);
    const ownerAcl = tableOwnerPrivileges.map((privilege) => ({ grantee: owner, privilege, grantable: false }));
    const grants = expected.grants.flatMap(({ role, privileges }) => privileges.map((privilege) => ({
      grantee: cutover075RoleName(names, ownerRoleName, role), privilege, grantable: false,
    })));
    if (!liveRelationStructureIsValid(actual)) {
      throw new Error(`cutover_075_post_relation_catalog_mismatch:${expected.relationName}`);
    }
    const acl = normalizeAcl(actual?.acl).filter((item) => !(item.grantee === owner && item.privilege === "MAINTAIN"));
    if (actual?.relation_name !== expected.relationName || actual.owner_role_name !== owner
      || exactJson(acl) !== exactJson(normalizeAcl([...ownerAcl, ...grants]))) {
      throw new Error(`cutover_075_post_relation_catalog_mismatch:${expected.relationName}`);
    }
  }

  const actualTriggers = [...(triggerRows ?? [])].map((row) => ({
    relationName: String(row.relation_name), triggerName: String(row.trigger_name),
    triggerType: Number(row.trigger_type), functionIdentity: String(row.function_identity),
    enabled: String(row.enabled), deferrable: row.deferrable === true,
    initiallyDeferred: row.initially_deferred === true,
    updateColumns: [...(row.update_columns ?? [])].map(String),
    whenClause: row.when_clause == null ? null : String(row.when_clause),
    definition: String(row.definition),
  })).sort((left, right) => lexicalCompare(`${left.relationName}|${left.triggerName}`, `${right.relationName}|${right.triggerName}`));
  if (exactJson(actualTriggers) !== exactJson(cutover075DomainTriggers)) {
    const mismatchIndex = Array.from(
      { length: Math.max(actualTriggers.length, cutover075DomainTriggers.length) },
      (_, index) => index,
    ).find((index) => exactJson(actualTriggers[index]) !== exactJson(cutover075DomainTriggers[index]));
    throw new Error(`cutover_075_post_trigger_catalog_mismatch:index=${mismatchIndex}:${JSON.stringify({
      actualCount: actualTriggers.length,
      expectedCount: cutover075DomainTriggers.length,
      actual: actualTriggers[mismatchIndex] ?? null,
      expected: cutover075DomainTriggers[mismatchIndex] ?? null,
    })}`);
  }
  const canonicalJson = JSON.stringify({
    contractVersion: "ai-content-075-post-security-catalog.v7",
    functions: actualFunctions.map(normalizeFunctionCatalog),
    relations: actualRelations.map((row) => ({
      relationName: String(row.relation_name), ...normalizeRelationStructure(row),
    })),
    triggers: actualTriggers,
  });
  return Object.freeze({
    functions: actualFunctions, relations: actualRelations, triggers: actualTriggers,
    canonicalJson, catalogSha256: checksum(canonicalJson),
  });
}

export async function readCutover075PostCatalog(client, names, {
  ownerRoleName = "postgres", cutover075Migration,
} = {}) {
  const functionResult = await client.query(
    `/* cutover_075_security_functions_v1 */
     select requested.identity,
            encode(sha256(convert_to(pg_get_functiondef(function.oid),'UTF8')),'hex') as definition_sha256,
            encode(sha256(convert_to(function.prosrc,'UTF8')),'hex') as source_sha256,
            owner.rolname as owner_role_name,function.prosecdef as security_definer,
            language.lanname as language_name,function.prokind as function_kind,
            function.provolatile as volatility,function.proparallel as parallel_safety,
            function.proleakproof as leakproof,function.proisstrict as strict,
            function.proretset as return_set,
            return_namespace.nspname || '.' || return_type.typname as return_type_identity,
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
       join pg_language language on language.oid=function.prolang
       join pg_type return_type on return_type.oid=function.prorettype
       join pg_namespace return_namespace on return_namespace.oid=return_type.typnamespace
      order by requested.identity`,
    [cutover075SecurityFunctions.map(({ identity }) => identity)],
  );
  const relationResult = await client.query(
    `/* cutover_075_security_relations_v5 */
     select requested.relation_name,${relationStructureProjectionSql}
       from unnest($1::text[]) requested(relation_name)
       join pg_class relation on relation.oid=to_regclass('public.' || requested.relation_name)
       join pg_roles owner on owner.oid=relation.relowner
      order by requested.relation_name collate "C"`,
    [cutover075RelationSecurityCatalog.map(({ relationName }) => relationName)],
  );
  const relationNames = cutover075RelationSecurityCatalog.map(({ relationName }) => relationName);
  const oldTriggerNames = cutover075DomainTriggers
    .filter(({ relationName }) => !relationNames.includes(relationName))
    .map(({ triggerName }) => triggerName);
  const triggerResult = await client.query(
    `/* cutover_075_domain_triggers_v2 */
     select relation.relname as relation_name,trigger.tgname as trigger_name,
            trigger.tgtype::integer as trigger_type,trigger.tgenabled as enabled,
            trigger.tgdeferrable as deferrable,trigger.tginitdeferred as initially_deferred,
            coalesce((select array_agg(attribute.attname::text order by selected.ordinality)
              from unnest(trigger.tgattr::smallint[]) with ordinality selected(attribute_number,ordinality)
              join pg_attribute attribute on attribute.attrelid=trigger.tgrelid
                and attribute.attnum=selected.attribute_number),'{}'::text[]) as update_columns,
            pg_get_expr(trigger.tgqual,trigger.tgrelid) as when_clause,
             namespace.nspname || '.' || function.proname || '(' || pg_get_function_identity_arguments(function.oid) || ')' as function_identity,
             pg_get_triggerdef(trigger.oid,true) as definition
       from pg_trigger trigger
       join pg_class relation on relation.oid=trigger.tgrelid
       join pg_namespace relation_namespace on relation_namespace.oid=relation.relnamespace and relation_namespace.nspname='public'
       join pg_proc function on function.oid=trigger.tgfoid
       join pg_namespace namespace on namespace.oid=function.pronamespace
      where not trigger.tgisinternal
        and trigger.tgfoid<>'public.enforce_ai_content_write_fence()'::regprocedure
        and (relation.relname=any($1::text[]) or trigger.tgname=any($2::text[]))
      order by relation.relname,trigger.tgname`,
    [relationNames, oldTriggerNames],
  );
  return validateCutover075PostCatalog({
    functionRows: functionResult.rows, relationRows: relationResult.rows, triggerRows: triggerResult.rows,
  }, names, ownerRoleName, buildCutover075FunctionSourceHashes(cutover075Migration));
}

export async function readFenceSecurityCatalog(client, names, {
  ownerRoleName = names.schemaOwnerRoleName,
  cutover075Applied = false,
  cutover075Migration,
} = {}) {
  const functionResult = await client.query(
    `/* fence_security_functions_v1 */
     select requested.identity,
            encode(sha256(convert_to(pg_get_functiondef(function.oid),'UTF8')),'hex') as definition_sha256,
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
  const roleByKey = {
    application: names.applicationRoleName,
    operator: names.operatorRoleName,
    migration: names.migrationRoleName,
    schemaOwner: names.schemaOwnerRoleName,
  };
  for (const expected of fenceSecurityFunctions) {
    const actual = functionByIdentity.get(expected.identity);
    const extras = [expected.execute, expected.executeAlso].filter(Boolean)
      .map((role) => roleByKey[role])
      .filter((grantee) => grantee !== ownerRoleName)
      .map((grantee) => ({ grantee, privilege: "EXECUTE", grantable: false }));
    if (!actual || actual.owner_role_name !== ownerRoleName
      || actual.security_definer !== expected.securityDefiner
      || exactJson([...(actual.config ?? [])].map((item) => String(item).replace(/\s+/g, "")).sort(lexicalCompare)) !== exactJson(expected.config)
      || exactJson(normalizeAcl(actual.acl)) !== exactJson(expectedAcl(ownerRoleName, extras))) {
      throw new Error(`bootstrap_074_fence_security_function_mismatch:${expected.identity}:${JSON.stringify({ owner: actual?.owner_role_name, securityDefiner: actual?.security_definer, config: actual?.config, acl: normalizeAcl(actual?.acl) })}`);
    }
  }
  const triggerResult = await client.query(
    `/* fence_security_ordinary_triggers_v2 */
     select relation.relname as relation_name,trigger.tgname as trigger_name,
             trigger.tgtype::integer as trigger_type,trigger.tgenabled as enabled,
             namespace.nspname || '.' || function.proname || '(' || pg_get_function_identity_arguments(function.oid) || ')' as function_identity,
             pg_get_triggerdef(trigger.oid,true) as definition
       from pg_trigger trigger
       join pg_class relation on relation.oid=trigger.tgrelid
       join pg_namespace relation_namespace on relation_namespace.oid=relation.relnamespace and relation_namespace.nspname='public'
       join pg_proc function on function.oid=trigger.tgfoid
       join pg_namespace namespace on namespace.oid=function.pronamespace
      where not trigger.tgisinternal and trigger.tgfoid='public.enforce_ai_content_write_fence()'::regprocedure
      order by relation.relname`,
  );
  const expectedTriggerRelations = cutover075Applied
    ? [...bootstrapFenceRelations, ...cutover075FenceCatalog
      .filter((row) => row.relation_class === "customer_execution")
      .map((row) => row.relation_name)].sort(lexicalCompare)
    : bootstrapFenceRelations;
  if (triggerResult.rows.length !== expectedTriggerRelations.length) throw new Error("bootstrap_074_fence_security_trigger_mismatch");
  for (const row of triggerResult.rows) {
    const expectedName = `ai_content_fence_${String(row.relation_name).slice(0, 30)}_${createHash("md5").update(String(row.relation_name)).digest("hex").slice(0, 12)}`;
    const expectedDefinition = `CREATE TRIGGER ${expectedName} BEFORE INSERT OR DELETE OR UPDATE ON ${row.relation_name} FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_write_fence()`;
    if (!expectedTriggerRelations.includes(String(row.relation_name)) || row.trigger_name !== expectedName
      || Number(row.trigger_type) !== 31 || row.enabled !== "A"
      || row.function_identity !== "public.enforce_ai_content_write_fence()"
      || row.definition !== expectedDefinition) {
      throw new Error("bootstrap_074_fence_security_trigger_mismatch");
    }
  }
  const controlTriggerResult = await client.query(
    `/* fence_security_control_triggers_v2 */
     select relation.relname as relation_name,trigger.tgname as trigger_name,
            trigger.tgtype::integer as trigger_type,trigger.tgenabled as enabled,
            trigger.tgdeferrable as deferrable,trigger.tginitdeferred as initially_deferred,
            namespace.nspname || '.' || function.proname || '(' || pg_get_function_identity_arguments(function.oid) || ')' as function_identity,
            pg_get_triggerdef(trigger.oid,true) as definition
       from pg_trigger trigger
       join pg_class relation on relation.oid=trigger.tgrelid
       join pg_namespace relation_namespace on relation_namespace.oid=relation.relnamespace and relation_namespace.nspname='public'
       join pg_proc function on function.oid=trigger.tgfoid
       join pg_namespace namespace on namespace.oid=function.pronamespace
      where not trigger.tgisinternal
        and relation.relname=any($1::text[])
      order by relation.relname,trigger.tgname`,
    [fenceControlRelations],
  );
  const expectedControlTriggers = [{
    relation_name: "ai_content_bootstrap_state", trigger_name: "ai_content_bootstrap_075_registration_must_clear",
    trigger_type: 21, enabled: "O", deferrable: true, initially_deferred: true,
    function_identity: "public.enforce_ai_content_075_registration_seal_cleared()",
    definition: "CREATE CONSTRAINT TRIGGER ai_content_bootstrap_075_registration_must_clear AFTER INSERT OR UPDATE ON ai_content_bootstrap_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_075_registration_seal_cleared()",
  }, {
    relation_name: "ai_content_cutover_status_events", trigger_name: "ai_content_cutover_status_events_immutable",
    trigger_type: 27, enabled: "O", deferrable: false, initially_deferred: false,
    function_identity: "public.forbid_ai_content_cutover_event_mutation()",
    definition: "CREATE TRIGGER ai_content_cutover_status_events_immutable BEFORE DELETE OR UPDATE ON ai_content_cutover_status_events FOR EACH ROW EXECUTE FUNCTION forbid_ai_content_cutover_event_mutation()",
  }];
  if (exactJson(controlTriggerResult.rows.map((row) => ({
    relation_name: String(row.relation_name), trigger_name: String(row.trigger_name),
    trigger_type: Number(row.trigger_type), enabled: String(row.enabled),
    deferrable: row.deferrable === true, initially_deferred: row.initially_deferred === true,
    function_identity: String(row.function_identity),
    definition: String(row.definition),
  }))) !== exactJson(expectedControlTriggers)) {
    throw new Error("bootstrap_074_fence_security_control_trigger_mismatch");
  }
  const catalogResult = await client.query(
    `/* fence_security_catalog_rows_v1 */
     select relation_name,relation_class,row_classifier
       from ai_content_write_fence_catalog order by relation_name collate "C"`,
  );
  const expectedFenceCatalog = cutover075Applied
    ? [...bootstrapFenceCatalog, ...cutover075FenceCatalog].sort((left, right) => lexicalCompare(left.relation_name, right.relation_name))
    : bootstrapFenceCatalog;
  const catalogText = catalogResult.rows.map((row) => `${row.relation_name}|${row.relation_class}|${row.row_classifier}`).join("\n");
  const expectedCatalogText = expectedFenceCatalog.map((row) => `${row.relation_name}|${row.relation_class}|${row.row_classifier}`).join("\n");
  if (catalogResult.rows.length !== expectedFenceCatalog.length || catalogText !== expectedCatalogText) {
    throw new Error("bootstrap_074_fence_security_catalog_mismatch");
  }
  const controlResult = await client.query(
    `/* fence_security_control_relations_v3 */
     select requested.relation_name,${relationStructureProjectionSql}
       from unnest($1::text[]) requested(relation_name)
       join pg_class relation on relation.oid=to_regclass('public.' || requested.relation_name)
       join pg_roles owner on owner.oid=relation.relowner
      order by requested.relation_name`,
    [fenceControlRelations],
  );
  if (controlResult.rows.length !== fenceControlRelations.length) throw new Error("bootstrap_074_fence_security_control_mismatch");
  for (const row of controlResult.rows) {
    const extra = [];
    if (row.relation_name === "ai_content_cutovers" && ownerRoleName !== names.schemaOwnerRoleName) {
      extra.push({ grantee: names.schemaOwnerRoleName, privilege: "REFERENCES", grantable: false });
    }
    if (row.relation_name === "ai_content_maintenance_state") {
      extra.push({ grantee: names.applicationRoleName, privilege: "SELECT", grantable: false });
    }
    if (["ai_content_bootstrap_state", "ai_content_ddl_allowlist", "ai_content_write_fence_catalog"].includes(row.relation_name)) {
      extra.push({ grantee: names.migrationRoleName, privilege: "SELECT", grantable: false });
    }
    if (row.relation_name === "ai_content_bootstrap_state" && ownerRoleName !== names.schemaOwnerRoleName) {
      extra.push({ grantee: names.schemaOwnerRoleName, privilege: "SELECT", grantable: false });
    }
    const ownerAcl = tableOwnerPrivileges.map((privilege) => ({ grantee: ownerRoleName, privilege, grantable: false }));
    const actualAcl = normalizeAcl(row.acl).filter((item) => !(
      item.grantee === ownerRoleName && item.privilege === "MAINTAIN"
    ));
    if (!liveRelationStructureIsValid(row) || row.row_security || row.force_row_security
      || row.rules.length !== 0 || row.policies.length !== 0
      || row.owner_role_name !== ownerRoleName
      || exactJson(actualAcl) !== exactJson(normalizeAcl([...ownerAcl, ...extra]))) {
      throw new Error(`bootstrap_074_fence_security_control_mismatch:${row.relation_name}:${JSON.stringify({ owner: row.owner_role_name, acl: normalizeAcl(row.acl) })}`);
    }
  }
  let post075Catalog = null;
  if (cutover075Applied) {
    post075Catalog = await readCutover075PostCatalog(client, names, { ownerRoleName, cutover075Migration });
  }
  const catalog = {
    functions: functionResult.rows,
    ordinaryTriggers: cutover075Applied
      ? triggerResult.rows.filter((row) => bootstrapFenceRelations.includes(String(row.relation_name)))
      : triggerResult.rows,
    controlTriggers: controlTriggerResult.rows,
    fenceCatalog: cutover075Applied
      ? catalogResult.rows.filter((row) => bootstrapFenceCatalog.some((expected) => expected.relation_name === row.relation_name))
      : catalogResult.rows,
    controlRelations: controlResult.rows,
  };
  return {
    ...catalog,
    ...(post075Catalog ? { post075Catalog } : {}),
    canonicalJson: canonicalFenceSecurityCatalog(catalog),
    catalogSha256: hashFenceSecurityCatalog(catalog),
    stableCoreCanonicalJson: canonicalFenceSecurityStableCore(catalog),
    stableCoreSha256: hashFenceSecurityStableCore(catalog),
  };
}

export async function readCanonicalBootstrapRoleCatalog(client, names) {
  const roleNames = [names.schemaOwnerRoleName, names.applicationRoleName, names.operatorRoleName,
    names.migrationRoleName, names.cleanupRoleName];
  const roleResult = await client.query(
    `/* bootstrap_role_catalog_v4 */
     select role.rolname as role_name,role.rolcanlogin as can_login,role.rolsuper as is_superuser,
             role.rolbypassrls as bypass_rls,role.rolcreatedb as can_create_db,
             role.rolcreaterole as can_create_role,role.rolreplication as can_replicate,
             role.rolinherit as inherit,coalesce(role.rolconfig,'{}'::text[]) as config
       from pg_roles role
      where role.rolname=any($1::name[])
       order by role.rolname`,
    [roleNames],
  );
  const membershipResult = await client.query(
    `/* bootstrap_role_membership_catalog_v2 */
     select member.rolname as member_role_name,parent.rolname as parent_role_name,
            membership.set_option,membership.inherit_option,membership.admin_option
       from pg_auth_members membership
       join pg_roles member on member.oid=membership.member
       join pg_roles parent on parent.oid=membership.roleid
      where membership.member=any(select oid from pg_roles where rolname=any($1::name[]))
         or membership.roleid=any(select oid from pg_roles where rolname=any($1::name[]))
      order by member.rolname,parent.rolname`,
    [roleNames],
  );
  const environmentResult = await client.query(
    `/* bootstrap_role_environment_catalog_v1 */
     select current_database() as database_name,database_owner.rolname as database_owner_role_name,
            schema_owner.rolname as public_schema_owner_role_name,
            coalesce((select jsonb_agg(jsonb_build_object(
              'grantee',case schema_acl.grantee when 0 then 'PUBLIC' else schema_grantee.rolname end,
              'privilege',schema_acl.privilege_type,'grantable',schema_acl.is_grantable
            ) order by (case schema_acl.grantee when 0 then 'PUBLIC' else schema_grantee.rolname end) collate "C",
              schema_acl.privilege_type collate "C")
              from aclexplode(coalesce(public_schema.nspacl,acldefault('n',public_schema.nspowner))) schema_acl
              left join pg_roles schema_grantee on schema_grantee.oid=schema_acl.grantee),'[]'::jsonb) as public_schema_acl,
            coalesce((select jsonb_agg(jsonb_build_object(
              'role_name',setting_role.rolname,
              'database_name',case setting.setdatabase when 0 then null else setting_database.datname end,
              'settings',setting.setconfig
            ) order by setting_role.rolname collate "C",setting.setdatabase)
              from pg_db_role_setting setting
              left join pg_roles setting_role on setting_role.oid=setting.setrole
              left join pg_database setting_database on setting_database.oid=setting.setdatabase
             where setting.setdatabase=(select oid from pg_database where datname=current_database())
               and (setting.setrole=0
                 or setting.setrole=any(select oid from pg_roles where rolname=any($1::name[])))),
              '[]'::jsonb) as database_settings,
            session_user::text as session_user_name,current_user::text as current_user_name,
            current_setting('search_path') as effective_search_path
       from pg_database database_record
       join pg_roles database_owner on database_owner.oid=database_record.datdba
       join pg_namespace public_schema on public_schema.nspname='public'
       join pg_roles schema_owner on schema_owner.oid=public_schema.nspowner
      where database_record.datname=current_database()`,
    [roleNames],
  );
  const environment = environmentResult.rows[0];
  const roleCatalog = {
    roles: roleResult.rows,
    membershipEdges: membershipResult.rows,
    databaseSettings: environment?.database_settings,
    database: {
      database_name: environment?.database_name,
      owner_role_name: environment?.database_owner_role_name,
    },
    publicSchema: {
      owner_role_name: environment?.public_schema_owner_role_name,
      acl: environment?.public_schema_acl,
    },
    session: environment,
  };
  validateBootstrapRoleSafety(roleCatalog, names);
  return {
    roleRows: roleResult.rows,
    membershipEdges: membershipResult.rows,
    databaseSettings: roleCatalog.databaseSettings,
    database: roleCatalog.database,
    publicSchema: roleCatalog.publicSchema,
    session: roleCatalog.session,
    roleCatalogSha256: hashBootstrapRoleCatalog(roleCatalog),
  };
}

export async function readCanonicalBootstrapCatalogs(client, names) {
  const roleNames = [names.schemaOwnerRoleName, names.applicationRoleName, names.operatorRoleName,
    names.migrationRoleName, names.cleanupRoleName];
  const roleCatalog = await readCanonicalBootstrapRoleCatalog(client, names);
  const triggerDependencyPairs = bootstrapTriggerFunctionDependencies.flatMap((entry) => (
    entry.dependencyFunctionIdentities.map((dependencyFunctionIdentity) => ({
      triggerFunctionIdentity: entry.triggerFunctionIdentity,
      dependencyFunctionIdentity,
    }))
  ));
  const objectResult = await client.query(
    `/* bootstrap_object_catalog_v7 */
     select namespace.nspname as schema_name,relation.relname as relation_name,
            ${relationStructureProjectionSql},
            coalesce((select jsonb_agg(jsonb_build_object(
              'trigger_name',trigger.tgname,'definition',pg_get_triggerdef(trigger.oid,true),
              'enabled',trigger.tgenabled,'deferrable',trigger.tgdeferrable,
              'initially_deferred',trigger.tginitdeferred,
              'function_identity',function_namespace.nspname || '.' || function.proname ||
                '(' || pg_get_function_identity_arguments(function.oid) || ')',
              'function_catalog',${functionCatalogJsonSql({
                functionAlias: "function", namespaceAlias: "function_namespace",
                ownerAlias: "function_owner", languageAlias: "function_language",
                returnTypeAlias: "function_return_type", returnNamespaceAlias: "function_return_namespace",
                aclAlias: "function_acl", aclGranteeAlias: "function_acl_grantee",
              })} || jsonb_build_object(
                'dependency_functions',coalesce((select jsonb_agg(
                  ${functionCatalogJsonSql({
                    functionAlias: "dependency_function", namespaceAlias: "dependency_namespace",
                    ownerAlias: "dependency_owner", languageAlias: "dependency_language",
                    returnTypeAlias: "dependency_return_type", returnNamespaceAlias: "dependency_return_namespace",
                    aclAlias: "dependency_acl", aclGranteeAlias: "dependency_acl_grantee",
                    identitySql: "dependency_manifest.dependency_identity",
                  })} order by dependency_manifest.dependency_identity collate "C")
                  from unnest($2::text[],$3::text[])
                    dependency_manifest(trigger_function_identity,dependency_identity)
                  join pg_proc dependency_function
                    on dependency_function.oid=to_regprocedure(dependency_manifest.dependency_identity)
                  join pg_namespace dependency_namespace
                    on dependency_namespace.oid=dependency_function.pronamespace
                  join pg_roles dependency_owner on dependency_owner.oid=dependency_function.proowner
                  join pg_language dependency_language on dependency_language.oid=dependency_function.prolang
                  join pg_type dependency_return_type on dependency_return_type.oid=dependency_function.prorettype
                  join pg_namespace dependency_return_namespace
                    on dependency_return_namespace.oid=dependency_return_type.typnamespace
                 where dependency_manifest.trigger_function_identity=
                   function_namespace.nspname || '.' || function.proname ||
                     '(' || pg_get_function_identity_arguments(function.oid) || ')'
                ),'[]'::jsonb)
              )
            ) order by trigger.tgname collate "C")
              from pg_trigger trigger join pg_proc function on function.oid=trigger.tgfoid
              join pg_namespace function_namespace on function_namespace.oid=function.pronamespace
              join pg_roles function_owner on function_owner.oid=function.proowner
              join pg_language function_language on function_language.oid=function.prolang
              join pg_type function_return_type on function_return_type.oid=function.prorettype
              join pg_namespace function_return_namespace
                on function_return_namespace.oid=function_return_type.typnamespace
             where trigger.tgrelid=relation.oid and not trigger.tgisinternal
               and not (
                 trigger.tgname='ai_content_fence_' || left(relation.relname,30) || '_' || left(md5(relation.relname),12)
                 and function_namespace.nspname='public'
                 and function.proname='enforce_ai_content_write_fence'
                 and pg_get_function_identity_arguments(function.oid)=''
               )),'[]'::jsonb) as triggers
       from unnest($1::name[]) requested(relation_name)
       join pg_class relation on relation.relname=requested.relation_name
       join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
       join pg_roles owner on owner.oid=relation.relowner
      order by relation.relname collate "C"`,
    [
      bootstrapFenceRelations,
      triggerDependencyPairs.map(({ triggerFunctionIdentity }) => triggerFunctionIdentity),
      triggerDependencyPairs.map(({ dependencyFunctionIdentity }) => dependencyFunctionIdentity),
    ],
  );
  if (objectResult.rows.length !== bootstrapFenceRelations.length) throw new Error("bootstrap_object_catalog_invalid:relation_count");
  const invalidObject = objectResult.rows.find((row) => !liveRelationStructureIsValid(row)
    || row.owner_role_name !== names.schemaOwnerRoleName || !Array.isArray(row.triggers)
    || row.triggers.some((trigger) => !liveCatalogTriggerIsValid(trigger)));
  if (invalidObject) {
    const invalidTrigger = Array.isArray(invalidObject.triggers)
      ? invalidObject.triggers.find((trigger) => !liveCatalogTriggerIsValid(trigger))
      : null;
    throw new Error(`bootstrap_object_catalog_invalid:${String(invalidObject.relation_name)}:${String(invalidTrigger?.trigger_name ?? "relation")}`);
  }
  return {
    roleRows: roleCatalog.roleRows,
    membershipEdges: roleCatalog.membershipEdges,
    objectRows: objectResult.rows,
    roleCatalogSha256: roleCatalog.roleCatalogSha256,
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

const cutover075MigrationId = "075_ai_content_three_format_cutover.sql";
const cutoverAllowlistAuthorizationPayloadKeys = Object.freeze([
  "contractVersion", "algorithm", "keyId", "providerAttestationKeyId",
  "providerAttestationPublicKeySha256", "requestId", "cutoverId", "migrationId",
  "migrationSha256", "rows", "rowsSha256", "enforcementCatalogSha256", "issuedAt", "expiresAt",
]);
const cutoverAllowlistAuthorizationEnvelopeKeys = Object.freeze([
  ...cutoverAllowlistAuthorizationPayloadKeys,
  "signature",
]);
const cutoverAllowlistAttestationPayloadKeys = Object.freeze([
  "contractVersion", "algorithm", "keyId", "action", "requestId", "requestSha256",
  "cutoverId", "migrationId", "migrationSha256", "rowsSha256", "beforeCount",
  "beforeSha256", "afterCount", "afterSha256", "issuedAt",
]);
const cutoverAllowlistAttestationEnvelopeKeys = Object.freeze([
  ...cutoverAllowlistAttestationPayloadKeys,
  "signature",
]);

function normalizeCutoverDdlAllowlist(rows, errorCode = "cutover_075_allowlist_rows_invalid") {
  if (!Array.isArray(rows)) throw new Error(errorCode);
  const normalized = rows.map((row) => {
    assertExactObjectKeys(row, ["commandTag", "objectIdentityPattern"], errorCode);
    if (typeof row.commandTag !== "string" || !/^[A-Z][A-Z _]{1,63}$/.test(row.commandTag)
      || typeof row.objectIdentityPattern !== "string" || row.objectIdentityPattern.length === 0
      || row.objectIdentityPattern.length > 512) {
      throw new Error(errorCode);
    }
    return { commandTag: row.commandTag, objectIdentityPattern: row.objectIdentityPattern };
  }).sort((left, right) => lexicalCompare(
    `${left.commandTag}\0${left.objectIdentityPattern}`,
    `${right.commandTag}\0${right.objectIdentityPattern}`,
  ));
  if (new Set(normalized.map((row) => `${row.commandTag}\0${row.objectIdentityPattern}`)).size !== normalized.length) {
    throw new Error(errorCode);
  }
  return normalized;
}

function assertCutover075RoleNames(names) {
  const keys = ["schemaOwnerRoleName", "applicationRoleName", "operatorRoleName", "migrationRoleName", "cleanupRoleName"];
  if (!names || keys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(names[key] ?? ""))) {
    throw new Error("cutover_075_exact_allowlist_roles_invalid");
  }
  return names;
}

function cutover075FenceTriggerName(relationName) {
  return `ai_content_fence_${relationName.slice(0, 30)}_${createHash("md5").update(relationName).digest("hex").slice(0, 12)}`;
}

function splitCutover075DefinitionList(value) {
  const items = [];
  let start = 0;
  let depth = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (singleQuoted) {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") singleQuoted = false;
      continue;
    }
    if (doubleQuoted) {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') doubleQuoted = false;
      continue;
    }
    if (character === "'") singleQuoted = true;
    else if (character === '"') doubleQuoted = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (singleQuoted || doubleQuoted || depth !== 0) throw new Error("cutover_075_implicit_index_source_invalid");
  items.push(value.slice(start).trim());
  return items.filter(Boolean);
}

function cutover075GeneratedIndexName(relationName, columns, suffix) {
  const name = `${relationName}_${columns.length > 0 ? `${columns.join("_")}_` : ""}${suffix}`;
  if (Buffer.byteLength(name, "utf8") > 63) {
    throw new Error(`cutover_075_implicit_index_name_requires_explicit_constraint:${name}`);
  }
  return name;
}

function cutover075IndexColumns(definition, keyword) {
  const match = definition.match(new RegExp(`\\b${keyword}\\s*\\(([^)]*)\\)`, "i"));
  if (!match) throw new Error("cutover_075_implicit_index_source_invalid");
  return splitCutover075DefinitionList(match[1]).map((column) => {
    const normalized = column.trim().toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(normalized)) {
      throw new Error("cutover_075_implicit_index_name_requires_explicit_constraint");
    }
    return normalized;
  });
}

function deriveCutover075ImplicitIndexes(sql) {
  const indexes = [];
  const add = (name) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(name) || Buffer.byteLength(name, "utf8") > 63) {
      throw new Error(`cutover_075_implicit_index_name_requires_explicit_constraint:${name}`);
    }
    if (indexes.includes(name)) throw new Error(`cutover_075_implicit_index_collision:${name}`);
    indexes.push(name);
  };
  const addDefinition = (relationName, definition, { alter = false } = {}) => {
    const prefix = alter ? /^add\s+/i : /^/;
    const clause = definition.replace(prefix, "").trim();
    const named = clause.match(/^constraint\s+([a-z_][a-z0-9_]*)\s+(primary\s+key|unique)\b/i);
    if (named) {
      add(named[1].toLowerCase());
      return;
    }
    if (/^primary\s+key\b/i.test(clause)) {
      add(cutover075GeneratedIndexName(relationName, [], "pkey"));
      return;
    }
    if (/^unique\b/i.test(clause)) {
      add(cutover075GeneratedIndexName(relationName, cutover075IndexColumns(clause, "unique"), "key"));
      return;
    }
    if (alter || /^(?:constraint|check|foreign\s+key|exclude)\b/i.test(clause)) return;
    const column = clause.match(/^([a-z_][a-z0-9_]*)\b/i)?.[1]?.toLowerCase();
    if (!column) throw new Error("cutover_075_implicit_index_source_invalid");
    const inlineNamed = clause.match(/\bconstraint\s+([a-z_][a-z0-9_]*)\s+unique\b/i);
    if (inlineNamed) add(inlineNamed[1].toLowerCase());
    else if (/\bprimary\s+key\b/i.test(clause)) add(cutover075GeneratedIndexName(relationName, [], "pkey"));
    else if (/\bunique\b/i.test(clause)) add(cutover075GeneratedIndexName(relationName, [column], "key"));
  };

  for (const statement of topLevelStatements(sql)) {
    const normalizedStatement = statement.trim();
    const create = normalizedStatement.match(/^create\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)\s*$/i);
    if (create) {
      for (const definition of splitCutover075DefinitionList(create[2])) addDefinition(create[1].toLowerCase(), definition);
      continue;
    }
    const alter = normalizedStatement.match(/^alter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+([\s\S]*)$/i);
    if (alter) {
      for (const definition of splitCutover075DefinitionList(alter[2])) addDefinition(alter[1].toLowerCase(), definition, { alter: true });
    }
  }
  return indexes;
}

export function buildCutover075ExactDdlAllowlist(migration, names) {
  assertCutover075RoleNames(names);
  buildCutover075FunctionSourceHashes(migration);
  const rows = [];
  const add = (commandTag, objectIdentityPattern) => rows.push({ commandTag, objectIdentityPattern });
  const addSourceMatches = (expression, commandTag) => {
    for (const match of migration.sql.matchAll(expression)) {
      add(commandTag, `public.${match[1]}`);
    }
  };

  addSourceMatches(/^create table\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gim, "CREATE TABLE");
  addSourceMatches(/^alter table\s+(?:public\.)?([a-z_][a-z0-9_]*)\b/gim, "ALTER TABLE");
  for (const match of migration.sql.matchAll(
    /^alter table\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+rename column\s+[a-z_][a-z0-9_]*\s+to\s+([a-z_][a-z0-9_]*)\s*;/gim,
  )) {
    add("ALTER TABLE", `public.${match[1]}.${match[2]}`);
  }
  addSourceMatches(/^create\s+(?:unique\s+)?index\s+(?:public\.)?([a-z_][a-z0-9_]*)\b/gim, "CREATE INDEX");
  const explicitIndexNames = new Set(rows.filter(({ commandTag }) => commandTag === "CREATE INDEX")
    .map(({ objectIdentityPattern }) => objectIdentityPattern.slice("public.".length)));
  for (const indexName of deriveCutover075ImplicitIndexes(migration.sql)) {
    if (explicitIndexNames.has(indexName)) throw new Error(`cutover_075_implicit_index_collision:${indexName}`);
    add("CREATE INDEX", `public.${indexName}`);
  }
  for (const descriptor of cutover075SecurityFunctions) add("CREATE FUNCTION", pgCatalogQualifiedFunctionIdentity(descriptor.identity));

  for (const trigger of cutover075DomainTriggers) {
    const explicit = new RegExp(`^create\\s+(?:constraint\\s+)?trigger\\s+${trigger.triggerName}\\b`, "im").test(migration.sql);
    if (explicit) add("CREATE TRIGGER", `${trigger.triggerName} on public.${trigger.relationName}`);
  }
  const immutableLoop = migration.sql.match(
    /foreach\s+table_name\s+in\s+array\s+array\[([\s\S]*?)\]\s*loop[\s\S]*?table_name\s*\|\|\s*'_immutable'/i,
  );
  if (immutableLoop) {
    const relations = [...immutableLoop[1].matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((match) => match[1]);
    for (const relationName of relations) add("CREATE TRIGGER", `${relationName}_immutable on public.${relationName}`);
  }

  if (/\bregister_ai_content_075_fence_relations\s*\(\s*\)/i.test(migration.sql)) {
    for (const { relation_name: relationName, relation_class: relationClass } of cutover075FenceCatalog) {
      if (relationClass !== "customer_execution") continue;
      add("CREATE TRIGGER", `${cutover075FenceTriggerName(relationName)} on public.${relationName}`);
      add("ALTER TABLE", `public.${relationName}`);
    }
    rows.push(...cutover075OwnerAuthorizationRows);
    const roleName = (key) => key === "provider" ? "postgres" : names[`${key}RoleName`];
    for (const { relationName, grants } of cutover075RelationSecurityCatalog) {
      add("REVOKE", `table:public.${relationName}|PUBLIC|ALL`);
      for (const { role, privileges } of grants) {
        add("GRANT", `table:public.${relationName}|${roleName(role)}|${privileges.join(",")}`);
      }
    }
    for (const { identity, execute } of cutover075SecurityFunctions) {
      add("REVOKE", `function:${identity}|PUBLIC|ALL`);
      for (const role of execute) add("GRANT", `function:${identity}|${roleName(role)}|EXECUTE`);
    }
  }

  const recognizedTopLevel = /^(?:create\s+(?:or\s+replace\s+)?(?:table|function|(?:unique\s+)?index|(?:constraint\s+)?trigger)|alter\s+table)\b/i;
  for (const match of migration.sql.matchAll(/^(create|alter|drop)\s+[^\r\n]+/gim)) {
    if (!recognizedTopLevel.test(match[0])) throw new Error("cutover_075_exact_allowlist_source_invalid");
  }
  const uniqueRows = [...new Map(rows.map((row) => [`${row.commandTag}\0${row.objectIdentityPattern}`, row])).values()];
  return Object.freeze(normalizeCutoverDdlAllowlist(uniqueRows, "cutover_075_exact_allowlist_rows_invalid").map(Object.freeze));
}

export function validateCutover075ExactDdlAllowlist(rows, migration, names) {
  const normalized = normalizeCutoverDdlAllowlist(rows, "cutover_075_exact_allowlist_rows_invalid");
  const expected = buildCutover075ExactDdlAllowlist(migration, names);
  if (exactJson(normalized) !== exactJson(expected)) throw new Error("cutover_075_exact_allowlist_rows_invalid");
  return normalized;
}

export function validateCutover075OwnerAuthorizationRows(rows) {
  const normalized = normalizeCutoverDdlAllowlist(rows);
  const expectedFunctionRows = cutover075OwnerAuthorizationRows.filter(({ commandTag }) => commandTag === "ALTER FUNCTION");
  const actualFunctionRows = normalized.filter(({ commandTag }) => commandTag === "ALTER FUNCTION");
  const keys = new Set(normalized.map(({ commandTag, objectIdentityPattern }) => `${commandTag}\0${objectIdentityPattern}`));
  if (exactJson(actualFunctionRows) !== exactJson(expectedFunctionRows)
    || cutover075OwnerAuthorizationRows.some(({ commandTag, objectIdentityPattern }) => !keys.has(`${commandTag}\0${objectIdentityPattern}`))) {
    throw new Error("cutover_075_owner_authorization_rows_invalid");
  }
  return normalized;
}

export function canonicalCutoverDdlAllowlist(rows) {
  return JSON.stringify({
    contractVersion: "ai-content-075-ddl-allowlist-row-set.v1",
    rows: normalizeCutoverDdlAllowlist(rows),
  });
}

export function hashCutoverDdlAllowlist(rows) {
  return checksum(canonicalCutoverDdlAllowlist(rows));
}

export function canonicalCutoverAllowlistAuthorizationPayload(value) {
  assertExactObjectKeys(
    value,
    cutoverAllowlistAuthorizationPayloadKeys,
    "cutover_075_allowlist_authorization_envelope_invalid",
  );
  const payload = Object.fromEntries(
    cutoverAllowlistAuthorizationPayloadKeys.map((key) => [key, value[key]]),
  );
  payload.rows = normalizeCutoverDdlAllowlist(value.rows);
  if (JSON.stringify(value.rows) !== JSON.stringify(payload.rows)) {
    throw new Error("cutover_075_allowlist_rows_invalid");
  }
  return JSON.stringify(payload);
}

function cutoverAllowlistAuthorizationPayload(value) {
  assertExactObjectKeys(
    value,
    cutoverAllowlistAuthorizationEnvelopeKeys,
    "cutover_075_allowlist_authorization_envelope_invalid",
  );
  return Object.fromEntries(
    cutoverAllowlistAuthorizationPayloadKeys.map((key) => [key, value[key]]),
  );
}

function canonicalCutoverAllowlistAuthorizationEnvelope(value) {
  const payload = cutoverAllowlistAuthorizationPayload(value);
  decodeCanonicalEd25519Signature(value.signature, "cutover_075_allowlist_authorization");
  return JSON.stringify({
    ...JSON.parse(canonicalCutoverAllowlistAuthorizationPayload(payload)),
    signature: value.signature,
  });
}

export function hashCutoverAllowlistAuthorizationEnvelope(value) {
  return checksum(canonicalCutoverAllowlistAuthorizationEnvelope(value));
}

export function validateCutoverAllowlistAuthorization(authorization, context) {
  const payload = cutoverAllowlistAuthorizationPayload(authorization);
  if (authorization.contractVersion !== "ai-content-075-ddl-allowlist-authorization.v1") {
    throw new Error("cutover_075_allowlist_authorization_contract_invalid");
  }
  verifyPinnedEd25519(
    canonicalCutoverAllowlistAuthorizationPayload(payload),
    authorization,
    context.authorizationVerification,
    "cutover_075_allowlist_authorization",
  );
  loadPinnedEd25519PublicKey(
    context.providerAttestationVerification,
    "cutover_075_allowlist_authorization_provider",
  );
  if (authorization.providerAttestationKeyId !== context.providerAttestationVerification?.expectedKeyId
    || authorization.providerAttestationPublicKeySha256
      !== context.providerAttestationVerification?.expectedPublicKeySha256) {
    throw new Error("cutover_075_allowlist_authorization_provider_identity_mismatch");
  }
  const now = new Date(context.now ?? Date.now()).getTime();
  const issued = Date.parse(authorization.issuedAt);
  const expires = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(issued) || issued > now) {
    throw new Error("cutover_075_allowlist_authorization_not_yet_valid");
  }
  if (!Number.isFinite(expires) || (!context.allowExpiredSealed && expires < now)
    || expires <= issued || expires-issued > 15*60*1000) {
    throw new Error("cutover_075_allowlist_authorization_expired");
  }
  if (!exactUuid(authorization.requestId)
    || !exactUuid(authorization.cutoverId)
    || authorization.cutoverId !== context.cutoverId
    || authorization.migrationId !== cutover075MigrationId
    || authorization.migrationId !== context.migration?.id
    || authorization.migrationSha256 !== context.migration?.checksum
    || !exactHex(authorization.migrationSha256, 64)
    || !exactHex(authorization.rowsSha256, 64)
    || authorization.rowsSha256 !== hashCutoverDdlAllowlist(authorization.rows)
    || !exactHex(authorization.enforcementCatalogSha256, 64)
    || authorization.enforcementCatalogSha256 !== context.enforcementCatalogSha256) {
    throw new Error("cutover_075_allowlist_authorization_identity_invalid");
  }
  validateCutover075ExactDdlAllowlist(authorization.rows, context.migration, context.roleNames);
  return JSON.parse(canonicalCutoverAllowlistAuthorizationEnvelope(authorization));
}

export function canonicalCutoverAllowlistAttestationPayload(value) {
  assertExactObjectKeys(
    value,
    cutoverAllowlistAttestationPayloadKeys,
    "cutover_075_allowlist_attestation_envelope_invalid",
  );
  return JSON.stringify(Object.fromEntries(
    cutoverAllowlistAttestationPayloadKeys.map((key) => [key, value[key]]),
  ));
}

function cutoverAllowlistAttestationPayload(value) {
  assertExactObjectKeys(
    value,
    cutoverAllowlistAttestationEnvelopeKeys,
    "cutover_075_allowlist_attestation_envelope_invalid",
  );
  return Object.fromEntries(
    cutoverAllowlistAttestationPayloadKeys.map((key) => [key, value[key]]),
  );
}

export function hashCutoverAllowlistAttestationEnvelope(value) {
  const payload = cutoverAllowlistAttestationPayload(value);
  decodeCanonicalEd25519Signature(value.signature, "cutover_075_allowlist_attestation");
  return checksum(JSON.stringify({
    ...JSON.parse(canonicalCutoverAllowlistAttestationPayload(payload)),
    signature: value.signature,
  }));
}

export function validateCutoverAllowlistAttestation(attestation, {
  authorization,
  providerAttestationVerification,
  now,
}) {
  const payload = cutoverAllowlistAttestationPayload(attestation);
  if (attestation.contractVersion !== "ai-content-075-ddl-allowlist-attestation.v1") {
    throw new Error("cutover_075_allowlist_attestation_contract_invalid");
  }
  verifyPinnedEd25519(
    canonicalCutoverAllowlistAttestationPayload(payload),
    attestation,
    providerAttestationVerification,
    "cutover_075_allowlist_attestation",
  );
  const issued = Date.parse(attestation.issuedAt);
  const currentTime = new Date(now ?? Date.now()).getTime();
  if (!Number.isFinite(issued) || issued < Date.parse(authorization.issuedAt)
    || issued > Date.parse(authorization.expiresAt) || issued > currentTime) {
    throw new Error("cutover_075_allowlist_attestation_stale");
  }
  const requestSha256 = hashCutoverAllowlistAuthorizationEnvelope(authorization);
  const expected = {
    action: "install_verify_075_ddl_allowlist",
    requestId: authorization.requestId,
    requestSha256,
    cutoverId: authorization.cutoverId,
    migrationId: authorization.migrationId,
    migrationSha256: authorization.migrationSha256,
    rowsSha256: authorization.rowsSha256,
    afterCount: authorization.rows.length,
    afterSha256: authorization.rowsSha256,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (attestation[key] !== value) {
      throw new Error(`cutover_075_allowlist_attestation_${key}_mismatch`);
    }
  }
  const emptySha256 = hashCutoverDdlAllowlist([]);
  const recoveredExact = attestation.beforeCount === authorization.rows.length
    && attestation.beforeSha256 === authorization.rowsSha256;
  const freshInstall = attestation.beforeCount === 0 && attestation.beforeSha256 === emptySha256;
  if ((!freshInstall && !recoveredExact) || !Number.isInteger(attestation.beforeCount)
    || !exactHex(attestation.beforeSha256, 64)) {
    throw new Error("cutover_075_allowlist_attestation_before_state_invalid");
  }
  return JSON.parse(JSON.stringify(attestation));
}

const defaultJournalFilesystem = Object.freeze({ lstat, open, link, unlink });

async function assertSecureJournalDirectory(directory, { platform, uid }, filesystem) {
  if (platform === "win32" || uid !== 0) {
    throw new Error("cutover_075_secure_journal_platform_unsupported");
  }
  const metadata = await filesystem.lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0
    || (metadata.mode & 0o077) !== 0) {
    throw new Error("cutover_075_secure_journal_directory_invalid");
  }
}

async function readJournalRecord(fileName, security, filesystem) {
  let pathMetadata;
  try {
    pathMetadata = await filesystem.lstat(fileName);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  if (pathMetadata.isSymbolicLink()) {
    throw new Error("cutover_075_secure_journal_record_invalid");
  }
  let handle;
  try {
    handle = await filesystem.open(fileName, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.uid !== security.uid || (metadata.mode & 0o077) !== 0
      || metadata.size <= 0 || metadata.size > 64*1024) {
      throw new Error("cutover_075_secure_journal_record_invalid");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function writeExclusiveJournalRecord(fileName, value, filesystem) {
  const temporaryName = `${fileName}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const handle = await filesystem.open(temporaryName, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await filesystem.link(temporaryName, fileName);
  } finally {
    await filesystem.unlink(temporaryName).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  const directoryHandle = await filesystem.open(path.dirname(fileName), fsConstants.O_RDONLY);
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
}

export function createCutover075ProviderJournal({
  directory,
  platform = process.platform,
  uid = process.getuid?.(),
  filesystem = defaultJournalFilesystem,
}) {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("cutover_075_secure_journal_directory_required");
  }
  const security = { platform, uid };
  const fileName = (requestId, state) => path.join(directory, `${requestId}.${state}.json`);
  const assertDirectory = () => assertSecureJournalDirectory(directory, security, filesystem);
  return {
    async read(requestId) {
      if (!exactUuid(requestId)) throw new Error("cutover_075_journal_request_invalid");
      await assertDirectory();
      const committed = await readJournalRecord(fileName(requestId, "committed"), security, filesystem);
      if (committed) return { state: "committed", value: committed };
      const prepared = await readJournalRecord(fileName(requestId, "prepared"), security, filesystem);
      return prepared ? { state: "prepared", value: prepared } : undefined;
    },
    async prepare(requestId, value) {
      await assertDirectory();
      await writeExclusiveJournalRecord(fileName(requestId, "prepared"), value, filesystem);
    },
    async commit(requestId, value) {
      await assertDirectory();
      try {
        await writeExclusiveJournalRecord(fileName(requestId, "committed"), value, filesystem);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = await readJournalRecord(fileName(requestId, "committed"), security, filesystem);
        if (JSON.stringify(existing) !== JSON.stringify(value)) {
          throw new Error("cutover_075_journal_reused");
        }
      }
    },
  };
}

export async function installCutover075AllowlistWithProvider({
  client,
  migration,
  authorization,
  attestation,
  authorizationVerification,
  providerAttestationVerification,
  now,
  journal,
}) {
  if (!journal || typeof journal.read !== "function" || typeof journal.prepare !== "function"
    || typeof journal.commit !== "function") {
    throw new Error("cutover_075_provider_journal_required");
  }
  const journalValue = {
    contractVersion: "ai-content-075-provider-journal.v1",
    requestSha256: hashCutoverAllowlistAuthorizationEnvelope(authorization),
    attestationSha256: hashCutoverAllowlistAttestationEnvelope(attestation),
  };
  const identity = await client.query("select session_user,current_user");
  if (identity.rows[0]?.session_user !== "postgres" || identity.rows[0]?.current_user !== "postgres") {
    throw new Error("cutover_075_provider_identity_invalid");
  }
  await client.query("begin");
  try {
    await client.query("lock table public.ai_content_ddl_allowlist in access exclusive mode");
    const stateResult = await client.query(
      `/* provider_075_sealed_state_v1 */
       select bootstrap.final_fence_security_catalog_sha256,
              bootstrap.schema_owner_role_name,bootstrap.application_role_name,
              bootstrap.operator_role_name,bootstrap.migration_role_name,bootstrap.cleanup_role_name,
              cutover.status as cutover_status,cutover.migration_id as cutover_migration_id,
              exists(select 1 from public.schema_migrations where id=$2) as marker_present
         from public.ai_content_bootstrap_state bootstrap
         join public.ai_content_cutovers cutover on cutover.id=$1
        where bootstrap.singleton
        for update of cutover`,
      [authorization.cutoverId, migration.id],
    );
    const state = stateResult.rows[0];
    if (!state || state.cutover_status !== "maintenance_verified"
      || state.cutover_migration_id !== migration.id || state.marker_present !== false
      || !exactHex(state.final_fence_security_catalog_sha256, 64)) {
      throw new Error("cutover_075_provider_state_invalid");
    }
    const readRows = async () => {
      const result = await client.query(
        `select command_tag,object_identity_pattern
           from public.ai_content_ddl_allowlist where migration_id=$1
          order by command_tag,object_identity_pattern`,
        [migration.id],
      );
      return result.rows.map((row) => ({
        commandTag: String(row.command_tag),
        objectIdentityPattern: String(row.object_identity_pattern),
      }));
    };
    const beforeRows = await readRows();
    const existingJournal = await journal.read(authorization.requestId);
    const exactJournal = existingJournal
      && ['prepared', 'committed'].includes(existingJournal.state)
      && JSON.stringify(existingJournal.value) === JSON.stringify(journalValue);
    if (existingJournal) {
      if (!exactJournal) {
        throw new Error("cutover_075_journal_reused");
      }
    }
    const beforeIsEmpty = beforeRows.length === 0;
    const claimedBeforeIsExact = Array.isArray(authorization.rows)
      && beforeRows.length === authorization.rows.length
      && hashCutoverDdlAllowlist(beforeRows) === authorization.rowsSha256;
    if (!beforeIsEmpty && !claimedBeforeIsExact) throw new Error("cutover_075_provider_allowlist_partial_or_extra");
    if (!existingJournal && claimedBeforeIsExact) throw new Error("cutover_075_direct_allowlist_insert_forbidden");
    if (existingJournal?.state === "committed" && !claimedBeforeIsExact) {
      throw new Error("cutover_075_committed_journal_live_state_invalid");
    }
    const validatedAuthorization = validateCutoverAllowlistAuthorization(authorization, {
      migration,
      cutoverId: authorization.cutoverId,
      enforcementCatalogSha256: state.final_fence_security_catalog_sha256,
      roleNames: {
        schemaOwnerRoleName: state.schema_owner_role_name,
        applicationRoleName: state.application_role_name,
        operatorRoleName: state.operator_role_name,
        migrationRoleName: state.migration_role_name,
        cleanupRoleName: state.cleanup_role_name,
      },
      authorizationVerification,
      providerAttestationVerification,
      now,
      allowExpiredSealed: Boolean(exactJournal && claimedBeforeIsExact),
    });
    const validatedAttestation = validateCutoverAllowlistAttestation(attestation, {
      authorization: validatedAuthorization,
      providerAttestationVerification,
      now,
    });
    const beforeIsExact = beforeRows.length === validatedAuthorization.rows.length
      && hashCutoverDdlAllowlist(beforeRows) === validatedAuthorization.rowsSha256;
    if (!existingJournal) {
      if (!beforeIsEmpty) throw new Error("cutover_075_direct_allowlist_insert_forbidden");
      if (validatedAttestation.beforeCount !== beforeRows.length
        || validatedAttestation.beforeSha256 !== hashCutoverDdlAllowlist(beforeRows)) {
        throw new Error("cutover_075_allowlist_attestation_before_live_mismatch");
      }
      await journal.prepare(authorization.requestId, journalValue);
    } else if (existingJournal.state === "prepared" && beforeIsEmpty
      && (validatedAttestation.beforeCount !== 0
        || validatedAttestation.beforeSha256 !== hashCutoverDdlAllowlist([]))) {
      throw new Error("cutover_075_allowlist_attestation_before_live_mismatch");
    }
    if (beforeIsEmpty) {
      await client.query(
        `insert into public.ai_content_ddl_allowlist (migration_id,command_tag,object_identity_pattern)
         select $1,rows.command_tag,rows.object_identity_pattern
           from unnest($2::text[],$3::text[]) rows(command_tag,object_identity_pattern)`,
        [migration.id, validatedAuthorization.rows.map((row) => row.commandTag),
          validatedAuthorization.rows.map((row) => row.objectIdentityPattern)],
      );
    }
    const afterRows = await readRows();
    if (afterRows.length !== validatedAuthorization.rows.length
      || hashCutoverDdlAllowlist(afterRows) !== validatedAuthorization.rowsSha256) {
      throw new Error("cutover_075_provider_allowlist_after_mismatch");
    }
    await client.query("commit");
    await journal.commit(authorization.requestId, journalValue);
    return JSON.parse(JSON.stringify(validatedAttestation));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

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

function exactUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
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
  if (!authorization || authorization.contractVersion !== "ai-content-bootstrap-role-authorization.v4") {
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
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now) {
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
    contractVersion: "ai-content-074-provider-install-request.v4",
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
    `/* bootstrap_event_trigger_catalog_v2 */
     select event_trigger.evtname as event_trigger_name,
            event_trigger.evtevent as event_trigger_event,
            coalesce(event_trigger.evttags,'{}'::text[]) as event_trigger_tags,
            owner.rolname as event_trigger_owner,
            case event_trigger.evtenabled when 'O' then 'enabled' else event_trigger.evtenabled::text end as event_trigger_enabled,
            namespace.nspname || '.' || function.proname as event_trigger_function,
            encode(sha256(convert_to(pg_get_functiondef(function.oid),'UTF8')),'hex') as event_trigger_function_sha256,
            ${functionCatalogJsonSql({
              functionAlias: "function", namespaceAlias: "namespace", ownerAlias: "function_owner",
              languageAlias: "function_language", returnTypeAlias: "function_return_type",
              returnNamespaceAlias: "function_return_namespace", aclAlias: "function_acl",
              aclGranteeAlias: "function_acl_grantee",
            })} as function_catalog
       from pg_event_trigger event_trigger
       join pg_roles owner on owner.oid=event_trigger.evtowner
       join pg_proc function on function.oid=event_trigger.evtfoid
       join pg_namespace namespace on namespace.oid=function.pronamespace
       join pg_roles function_owner on function_owner.oid=function.proowner
       join pg_language function_language on function_language.oid=function.prolang
       join pg_type function_return_type on function_return_type.oid=function.prorettype
       join pg_namespace function_return_namespace on function_return_namespace.oid=function_return_type.typnamespace
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
    functionCatalog: normalizeFunctionCatalog(row.function_catalog),
  };
  const definitionSha256 = hashEventTriggerDefinition(evidence);
  if (evidence.eventTriggerName !== authorization.eventTriggerName
    || evidence.eventTriggerEvent !== authorization.eventTriggerEvent
    || JSON.stringify(evidence.eventTriggerTags) !== JSON.stringify([...authorization.eventTriggerTags].sort(lexicalCompare))
    || evidence.eventTriggerOwner !== authorization.eventTriggerOwner
    || evidence.eventTriggerEnabled !== "enabled"
    || evidence.eventTriggerFunction !== authorization.eventTriggerFunction
    || evidence.eventTriggerFunctionSha256 !== authorization.eventTriggerFunctionSha256
    || evidence.functionCatalog.identity !== `${authorization.eventTriggerFunction}()`
    || evidence.functionCatalog.definitionSha256 !== authorization.eventTriggerFunctionSha256
    || evidence.functionCatalog.ownerRoleName !== authorization.eventTriggerOwner
    || evidence.functionCatalog.securityDefiner !== true
    || exactJson(evidence.functionCatalog.config) !== exactJson(["search_path=pg_catalog,public"])
    || exactJson(evidence.functionCatalog.acl) !== exactJson(normalizeAcl([
      { grantee: authorization.eventTriggerOwner, privilege: "EXECUTE", grantable: false },
    ]))
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

async function assertBootstrapSessionEnvironment(client, names, { afterSetRole = false } = {}) {
  const result = await client.query(
    `/* bootstrap_session_environment_v1 */
     select session_user::text as session_user_name,current_user::text as current_user_name,
            current_setting('search_path') as effective_search_path`,
  );
  const session = result.rows[0];
  const expectedCurrentRole = afterSetRole ? names.schemaOwnerRoleName : names.migrationRoleName;
  if (session?.session_user_name !== names.migrationRoleName
    || session?.current_user_name !== expectedCurrentRole
    || String(session?.effective_search_path).replace(/\s+/g, "") !== "public,pg_catalog,pg_temp") {
    throw new Error("bootstrap_role_session_environment_invalid");
  }
}

function validateBootstrap074PrerequisiteProviderRoleName(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    throw new Error("bootstrap_074_prerequisite_provider_role_invalid");
  }
  return value;
}

async function readLegacyTriggerSearchPathProviderOwner(client, providerRoleName) {
  const expectedProviderRoleName = validateBootstrap074PrerequisiteProviderRoleName(providerRoleName);
  const result = await client.query(
    `/* legacy_trigger_search_path_provider_owner_v1 */
     select min(owner.rolname::text) as owner_role_name,
            count(function.oid)::integer as function_count,
            count(distinct owner.rolname)::integer as owner_count,
            session_user::text as session_user_name,current_user::text as current_user_name
       from unnest($1::text[]) requested(identity)
       left join pg_proc function on function.oid=to_regprocedure(requested.identity)
       left join pg_roles owner on owner.oid=function.proowner`,
    [legacyTriggerSearchPathFunctionIdentities],
  );
  const owner = result.rows[0];
  if (!owner || Number(owner.function_count) !== legacyTriggerSearchPathFunctionIdentities.length
    || Number(owner.owner_count) !== 1
    || owner.owner_role_name !== expectedProviderRoleName
    || owner.session_user_name !== expectedProviderRoleName
    || owner.current_user_name !== expectedProviderRoleName) {
    throw new Error("legacy_trigger_search_path_provider_owner_invalid");
  }
  return expectedProviderRoleName;
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

const cutoverBodyEvidenceKeys = Object.freeze([
  "contractVersion", "cutoverId", "migrationId", "migrationSha256", "databaseRoleName",
  "schemaOwnerRoleName", "allowlistRowsSha256", "allowlistAuthorizationSha256",
  "allowlistAttestationSha256", "enforcementCatalogSha256", "enforcementStableCoreSha256",
  "provider074AttestationSha256",
  "post075CatalogSha256", "post075BootstrapObjectCatalogSha256", "proposalPreflightIdentity",
  "proposalPreflightIdentitySha256", "proposalPreflightTransferSha256",
]);

export function validateCutoverBodyEvidence(evidence, evidenceSha256, migration, cutover) {
  try {
    assertExactObjectKeys(evidence, cutoverBodyEvidenceKeys, "cutover_075_body_evidence_invalid");
  } catch {
    throw new Error("cutover_075_body_evidence_invalid");
  }
  const expected = {
    contractVersion: "ai-content-075-migration-body-evidence.v3",
    cutoverId: cutover.cutoverId,
    migrationId: migration.id,
    migrationSha256: migration.checksum,
    databaseRoleName: cutover.expectedDatabaseRole,
    schemaOwnerRoleName: cutover.schemaOwnerRoleName,
    allowlistRowsSha256: cutover.allowlistRowsSha256,
    allowlistAuthorizationSha256: cutover.allowlistAuthorizationSha256,
    allowlistAttestationSha256: cutover.allowlistAttestationSha256,
    enforcementCatalogSha256: cutover.enforcementCatalogSha256,
    enforcementStableCoreSha256: cutover.enforcementStableCoreSha256,
    provider074AttestationSha256: cutover.provider074AttestationSha256,
    post075CatalogSha256: cutover.post075CatalogSha256,
    post075BootstrapObjectCatalogSha256: cutover.post075BootstrapObjectCatalogSha256,
    proposalPreflightIdentity: cutover.proposalPreflightIdentity,
    proposalPreflightIdentitySha256: cutover.proposalPreflightIdentitySha256,
    proposalPreflightTransferSha256: cutover.proposalPreflightTransferSha256,
  };
  if (!exactHex(expected.enforcementStableCoreSha256, 64)
    || !exactHex(expected.post075CatalogSha256, 64)
    || !exactHex(expected.post075BootstrapObjectCatalogSha256, 64)
    || !exactHex(evidenceSha256, 64)
    || exactJson(evidence) !== exactJson(expected)
    || checksum(JSON.stringify(expected)) !== evidenceSha256) {
    throw new Error("cutover_075_body_evidence_invalid");
  }
  return { evidence: expected, evidenceSha256 };
}

export function buildCutoverBodyEvidence(migration, cutover) {
  if (!exactHex(cutover.enforcementStableCoreSha256, 64)
    || !exactHex(cutover.post075CatalogSha256, 64)
    || !exactHex(cutover.post075BootstrapObjectCatalogSha256, 64)) {
    throw new Error("cutover_075_post_catalog_evidence_required");
  }
  const evidence = {
    contractVersion: "ai-content-075-migration-body-evidence.v3",
    cutoverId: cutover.cutoverId,
    migrationId: migration.id,
    migrationSha256: migration.checksum,
    databaseRoleName: cutover.expectedDatabaseRole,
    schemaOwnerRoleName: cutover.schemaOwnerRoleName,
    allowlistRowsSha256: cutover.allowlistRowsSha256,
    allowlistAuthorizationSha256: cutover.allowlistAuthorizationSha256,
    allowlistAttestationSha256: cutover.allowlistAttestationSha256,
    enforcementCatalogSha256: cutover.enforcementCatalogSha256,
    enforcementStableCoreSha256: cutover.enforcementStableCoreSha256,
    provider074AttestationSha256: cutover.provider074AttestationSha256,
    post075CatalogSha256: cutover.post075CatalogSha256,
    post075BootstrapObjectCatalogSha256: cutover.post075BootstrapObjectCatalogSha256,
    proposalPreflightIdentity: cutover.proposalPreflightIdentity,
    proposalPreflightIdentitySha256: cutover.proposalPreflightIdentitySha256,
    proposalPreflightTransferSha256: cutover.proposalPreflightTransferSha256,
  };
  return validateCutoverBodyEvidence(
    evidence, checksum(JSON.stringify(evidence)), migration, cutover,
  );
}

const proposalPreflightIdentityKeys = Object.freeze([
  "preflightCandidateSha", "contentProposalWorkerImageDigest", "proposalWorkerSourceSha",
  "proposalWorkerTreeSha", "proposalContractSourceSha256", "proposalSchemaSha256",
  "proposalCatalogSha256", "proposalModelId", "proposalCommandDescriptorSha256", "migrationSha256",
]);

export function validateProposalPreflightIdentity(row, migrationSha256) {
  const identity = row?.proposal_preflight_identity_json;
  try {
    assertExactObjectKeys(identity, proposalPreflightIdentityKeys, "cutover_075_preflight_identity_invalid");
  } catch {
    throw new Error("cutover_075_preflight_identity_invalid");
  }
  if (!exactHex(identity.preflightCandidateSha, 40)
    || !/^sha256:[0-9a-f]{64}$/.test(identity.contentProposalWorkerImageDigest ?? "")
    || !exactHex(identity.proposalWorkerSourceSha, 40)
    || !exactHex(identity.proposalWorkerTreeSha, 40)
    || !exactHex(identity.proposalContractSourceSha256, 64)
    || !exactHex(identity.proposalSchemaSha256, 64)
    || !exactHex(identity.proposalCatalogSha256, 64)
    || identity.proposalModelId !== "gpt-5.6-terra"
    || !exactHex(identity.proposalCommandDescriptorSha256, 64)
    || identity.migrationSha256 !== migrationSha256
    || !exactHex(row.proposal_preflight_identity_sha256, 64)
    || row.live_proposal_preflight_identity_sha256 !== row.proposal_preflight_identity_sha256
    || !exactHex(row.proposal_preflight_transfer_sha256, 64)) {
    throw new Error("cutover_075_preflight_identity_invalid");
  }
  return {
    proposalPreflightIdentity: identity,
    proposalPreflightIdentitySha256: row.proposal_preflight_identity_sha256,
    proposalPreflightTransferSha256: row.proposal_preflight_transfer_sha256,
  };
}

function cutoverPreflightConfigValid(cutover, migrationSha256) {
  try {
    validateProposalPreflightIdentity({
      proposal_preflight_identity_json: cutover?.proposalPreflightIdentity,
      proposal_preflight_identity_sha256: cutover?.proposalPreflightIdentitySha256,
      live_proposal_preflight_identity_sha256: cutover?.proposalPreflightIdentitySha256,
      proposal_preflight_transfer_sha256: cutover?.proposalPreflightTransferSha256,
    }, migrationSha256);
    return true;
  } catch {
    return false;
  }
}

export function hashCutover075BootstrapEnvelopeState(state) {
  return checksum(JSON.stringify({
    authorizationRequestId: state.authorization_request_id,
    authorizationSha256: state.authorization_sha256,
    installRequestJson: state.install_request_json,
    installRequestSha256: state.install_request_sha256,
    providerAttestationJson: state.provider_attestation_json,
    providerAttestationSha256: state.provider_attestation_sha256,
    revocationRequestJson: state.revocation_request_json,
    revocationRequestSha256: state.revocation_request_sha256,
  }));
}

async function verifyCutover075Preconditions({ client, migration, cutover, bootstrap074, migration074, recovery = false }) {
  if (!cutover?.allowlistAuthorization || !cutover?.allowlistAttestation
    || !cutover.authorizationVerification || !cutover.providerAttestationVerification) {
    throw new Error("cutover_075_allowlist_attestation_required");
  }
  const identity = await client.query("select session_user, current_user");
  if (identity.rows[0]?.session_user !== cutover.expectedDatabaseRole
    || identity.rows[0]?.current_user !== cutover.expectedDatabaseRole
    || cutover.expectedDatabaseRole === "postgres") {
    throw new Error("cutover_075_database_role_invalid");
  }
  const stateResult = await client.query(
    `/* cutover_075_sealed_state_v1 */
     select bootstrap.migration_role_name as bootstrap_migration_role_name,
            bootstrap.authorization_request_id,bootstrap.authorization_sha256,
            bootstrap.schema_owner_role_name,bootstrap.application_role_name,
            bootstrap.operator_role_name,bootstrap.cleanup_role_name,
             bootstrap.role_catalog_sha256,
             bootstrap.final_fence_security_catalog_sha256,
            bootstrap.provider_attestation_sha256,bootstrap.attestation_consumed_at,
            bootstrap.install_request_json,bootstrap.install_request_sha256,
            bootstrap.provider_attestation_json,
            bootstrap.revocation_request_json,bootstrap.revocation_request_sha256,
            bootstrap.event_trigger_catalog_after_sha256,bootstrap.event_trigger_catalog_after_count
       from public.ai_content_bootstrap_state bootstrap where bootstrap.singleton`,
  );
  const state = stateResult.rows[0];
  if (!state || state.bootstrap_migration_role_name !== cutover.expectedDatabaseRole
    || !exactHex(state.role_catalog_sha256, 64)
    || !exactHex(state.final_fence_security_catalog_sha256, 64)
    || !exactHex(state.provider_attestation_sha256, 64) || !state.attestation_consumed_at
    || !exactHex(state.event_trigger_catalog_after_sha256, 64)
    || !Number.isInteger(state.event_trigger_catalog_after_count)) {
    throw new Error("cutover_075_sealed_state_invalid");
  }
  const names = {
    migrationRoleName: state.bootstrap_migration_role_name,
    schemaOwnerRoleName: state.schema_owner_role_name,
    applicationRoleName: state.application_role_name,
    operatorRoleName: state.operator_role_name,
    cleanupRoleName: state.cleanup_role_name,
  };
  const proposalPreflight = validateProposalPreflightIdentity({
    proposal_preflight_identity_json: cutover.proposalPreflightIdentity,
    proposal_preflight_identity_sha256: cutover.proposalPreflightIdentitySha256,
    live_proposal_preflight_identity_sha256: cutover.proposalPreflightIdentitySha256,
    proposal_preflight_transfer_sha256: cutover.proposalPreflightTransferSha256,
  }, migration.checksum);
  const verifiedPreflight = await client.query(
    "select verify_ai_content_cutover_preflight_identity($1,$2::jsonb,$3,$4) as verified",
    [cutover.cutoverId, JSON.stringify(proposalPreflight.proposalPreflightIdentity),
      proposalPreflight.proposalPreflightIdentitySha256, proposalPreflight.proposalPreflightTransferSha256],
  );
  if (verifiedPreflight.rows[0]?.verified !== true) throw new Error("cutover_075_preflight_identity_mismatch");
  if (!bootstrap074?.authorization || !migration074) {
    throw new Error("cutover_075_sealed_074_authorization_required");
  }
  const authorization074 = validateBootstrapRoleAuthorization(bootstrap074.authorization, {
    ...bootstrap074,
    migration: migration074,
    roleCatalogSha256: bootstrap074.authorization.roleCatalogSha256,
    objectCatalogSha256: bootstrap074.authorization.objectCatalogSha256,
    allowExpiredSealed: true,
  });
  const authorization074Sha256 = checksum(canonicalBootstrapAuthorizationPayload(
    bootstrapAuthorizationPayload(authorization074),
  ));
  const storedInstall = validateProviderEventTriggerInstallRequest(
    state.install_request_json,
    state.install_request_sha256,
  );
  const enforcementStableCoreSha256 = hashFenceSecurityStableCore(
    storedInstall.expectedFinalFenceSecurityCatalog,
  );
  const storedProviderAttestation = validateProviderEventTriggerAttestation(state.provider_attestation_json, {
    authorization: authorization074,
    installRequest: storedInstall,
    providerAttestationVerification: bootstrap074.providerAttestationVerification,
    finalFenceSecurityCatalogSha256: state.final_fence_security_catalog_sha256,
    now: bootstrap074.now,
  });
  const storedProviderAttestationSha256 = hashProviderAttestationEnvelope(storedProviderAttestation);
  const expectedRevocation = buildMembershipRevocationRequest(
    authorization074,
    storedInstall,
    storedProviderAttestationSha256,
  );
  validateMembershipRevocationEvidence(
    state.revocation_request_json,
    expectedRevocation,
    state.revocation_request_sha256,
  );
  if (state.authorization_request_id !== authorization074.requestId
    || state.authorization_sha256 !== authorization074Sha256
    || state.provider_attestation_sha256 !== storedProviderAttestationSha256
    || storedInstall.authorizationRequestId !== authorization074.requestId
    || storedInstall.roleCatalogSha256 !== state.role_catalog_sha256
    || storedInstall.expectedFinalFenceSecurityCatalogSha256 !== state.final_fence_security_catalog_sha256) {
    throw new Error("cutover_075_sealed_074_envelope_mismatch");
  }
  const authorization = validateCutoverAllowlistAuthorization(cutover.allowlistAuthorization, {
    migration,
    cutoverId: cutover.cutoverId,
    enforcementCatalogSha256: state.final_fence_security_catalog_sha256,
    authorizationVerification: cutover.authorizationVerification,
    providerAttestationVerification: cutover.providerAttestationVerification,
    roleNames: names,
    now: cutover.now,
    allowExpiredSealed: recovery,
  });
  validateCutoverAllowlistAttestation(cutover.allowlistAttestation, {
    authorization,
    providerAttestationVerification: cutover.providerAttestationVerification,
    now: cutover.now,
  });
  const marker = await client.query(
    "select exists(select 1 from schema_migrations where id=$1) as marker_present",
    [migration.id],
  );
  if (marker.rows[0]?.marker_present !== recovery) {
    throw new Error(recovery ? "cutover_075_recovery_marker_missing" : "cutover_075_marker_already_present");
  }
  const liveAllowlist = await client.query(
    `select command_tag,object_identity_pattern
       from public.ai_content_ddl_allowlist where migration_id=$1
      order by command_tag,object_identity_pattern`,
    [migration.id],
  );
  const liveRows = liveAllowlist.rows.map((row) => ({
    commandTag: String(row.command_tag),
    objectIdentityPattern: String(row.object_identity_pattern),
  }));
  if (liveRows.length !== authorization.rows.length
    || hashCutoverDdlAllowlist(liveRows) !== authorization.rowsSha256
    || JSON.stringify(normalizeCutoverDdlAllowlist(liveRows)) !== JSON.stringify(authorization.rows)) {
    throw new Error("cutover_075_live_allowlist_mismatch");
  }
  const liveRoles = recovery
    ? await readCanonicalBootstrapCatalogs(client, names)
    : await readCanonicalBootstrapRoleCatalog(client, names);
  if (liveRoles.roleCatalogSha256 !== state.role_catalog_sha256) {
    throw new Error("cutover_075_live_role_catalog_mismatch");
  }
  const verifiedFence = await client.query("select verify_ai_content_write_fence_catalog() as verified");
  if (verifiedFence.rows[0]?.verified !== true) throw new Error("cutover_075_fence_catalog_invalid");
  const liveFence = await readFenceSecurityCatalog(client, names, {
    ownerRoleName: "postgres",
    cutover075Applied: recovery,
    ...(recovery ? { cutover075Migration: migration } : {}),
  });
  if ((!recovery && liveFence.catalogSha256 !== state.final_fence_security_catalog_sha256)
    || (recovery && liveFence.stableCoreSha256 !== enforcementStableCoreSha256)) {
    throw new Error("cutover_075_enforcement_catalog_mismatch");
  }
  const liveEventTriggers = await readCanonicalEventTriggerCatalog(client);
  if (liveEventTriggers.catalogSha256 !== state.event_trigger_catalog_after_sha256
    || liveEventTriggers.count !== state.event_trigger_catalog_after_count) {
    throw new Error("cutover_075_event_trigger_catalog_mismatch");
  }
  return {
    ...cutover,
    schemaOwnerRoleName: state.schema_owner_role_name,
    allowlistRowsSha256: authorization.rowsSha256,
    allowlistAuthorizationSha256: hashCutoverAllowlistAuthorizationEnvelope(authorization),
    allowlistAttestationSha256: hashCutoverAllowlistAttestationEnvelope(cutover.allowlistAttestation),
    enforcementCatalogSha256: state.final_fence_security_catalog_sha256,
    enforcementStableCoreSha256,
    provider074AttestationSha256: state.provider_attestation_sha256,
    roleCatalogSha256: state.role_catalog_sha256,
    roleNames: names,
    sealed074Context: { bootstrap074, migration074 },
    eventTriggerCatalogSha256: state.event_trigger_catalog_after_sha256,
    eventTriggerCatalogCount: state.event_trigger_catalog_after_count,
    sealedBootstrapEnvelopeSha256: hashCutover075BootstrapEnvelopeState(state),
    ...proposalPreflight,
  };
}

async function revalidateAtomicCutoverDatabaseState({ client, migration, cutover, cutover075Applied = false }) {
  if (!cutover.sealed074Context?.bootstrap074 || !cutover.sealed074Context?.migration074
    || !cutover.roleNames || !exactHex(cutover.roleCatalogSha256, 64)
    || !exactHex(cutover.enforcementStableCoreSha256, 64)) {
    throw new Error("cutover_075_transaction_seal_required");
  }
  const locked = await client.query("select lock_ai_content_cutover_transaction_state($1) as locked", [cutover.cutoverId]);
  if (locked.rows[0]?.locked !== true) throw new Error("cutover_075_transaction_lock_failed");
  const bootstrap = await client.query(
    `/* cutover_075_transaction_bootstrap_lock_v1 */
     select bootstrap.migration_role_name,bootstrap.schema_owner_role_name,
            bootstrap.application_role_name,bootstrap.operator_role_name,
            bootstrap.cleanup_role_name,bootstrap.role_catalog_sha256,
            bootstrap.final_fence_security_catalog_sha256,
            bootstrap.authorization_request_id,bootstrap.authorization_sha256,
            bootstrap.install_request_json,bootstrap.install_request_sha256,
            bootstrap.provider_attestation_json,bootstrap.provider_attestation_sha256,
            bootstrap.attestation_consumed_at,bootstrap.revocation_request_json,
            bootstrap.revocation_request_sha256,bootstrap.event_trigger_catalog_after_sha256,
            bootstrap.event_trigger_catalog_after_count
       from public.ai_content_bootstrap_state bootstrap where bootstrap.singleton`,
  );
  const state = bootstrap.rows[0];
  let proposalPreflight;
  try {
    proposalPreflight = validateProposalPreflightIdentity({
      proposal_preflight_identity_json: cutover.proposalPreflightIdentity,
      proposal_preflight_identity_sha256: cutover.proposalPreflightIdentitySha256,
      live_proposal_preflight_identity_sha256: cutover.proposalPreflightIdentitySha256,
      proposal_preflight_transfer_sha256: cutover.proposalPreflightTransferSha256,
    }, migration.checksum);
  } catch {
    throw new Error("cutover_075_transaction_preflight_identity_drift");
  }
  const verifiedPreflight = await client.query(
    "select verify_ai_content_cutover_preflight_identity($1,$2::jsonb,$3,$4) as verified",
    [cutover.cutoverId, JSON.stringify(proposalPreflight.proposalPreflightIdentity),
      proposalPreflight.proposalPreflightIdentitySha256, proposalPreflight.proposalPreflightTransferSha256],
  );
  if (verifiedPreflight.rows[0]?.verified !== true) {
    throw new Error("cutover_075_transaction_preflight_identity_drift");
  }
  if (!state || state.migration_role_name !== cutover.expectedDatabaseRole
    || state.schema_owner_role_name !== cutover.schemaOwnerRoleName
    || state.application_role_name !== cutover.roleNames.applicationRoleName
    || state.operator_role_name !== cutover.roleNames.operatorRoleName
    || state.cleanup_role_name !== cutover.roleNames.cleanupRoleName
    || state.role_catalog_sha256 !== cutover.roleCatalogSha256
    || state.final_fence_security_catalog_sha256 !== cutover.enforcementCatalogSha256
    || state.provider_attestation_sha256 !== cutover.provider074AttestationSha256
    || !state.attestation_consumed_at
    || state.event_trigger_catalog_after_sha256 !== cutover.eventTriggerCatalogSha256
    || state.event_trigger_catalog_after_count !== cutover.eventTriggerCatalogCount
    || hashCutover075BootstrapEnvelopeState(state) !== cutover.sealedBootstrapEnvelopeSha256
    || exactJson(proposalPreflight.proposalPreflightIdentity) !== exactJson(cutover.proposalPreflightIdentity)
    || proposalPreflight.proposalPreflightIdentitySha256 !== cutover.proposalPreflightIdentitySha256
    || proposalPreflight.proposalPreflightTransferSha256 !== cutover.proposalPreflightTransferSha256) {
    throw new Error("cutover_075_transaction_bootstrap_drift");
  }
  const allowlist = await client.query(
    `/* cutover_075_transaction_allowlist_lock_v1 */
     select command_tag,object_identity_pattern from public.ai_content_ddl_allowlist
      where migration_id=$1 order by command_tag,object_identity_pattern`,
    [migration.id],
  );
  const allowlistRows = allowlist.rows.map((row) => ({
    commandTag: String(row.command_tag), objectIdentityPattern: String(row.object_identity_pattern),
  }));
  if (allowlistRows.length !== cutover.allowlistAuthorization.rows.length
    || hashCutoverDdlAllowlist(allowlistRows) !== cutover.allowlistRowsSha256) {
    throw new Error("cutover_075_transaction_allowlist_drift");
  }
  const liveBootstrapCatalogs = cutover075Applied
    ? await readCanonicalBootstrapCatalogs(client, cutover.roleNames)
    : null;
  const liveRoles = liveBootstrapCatalogs
    ?? await readCanonicalBootstrapRoleCatalog(client, cutover.roleNames);
  if (liveRoles.roleCatalogSha256 !== cutover.roleCatalogSha256) {
    throw new Error("cutover_075_transaction_role_catalog_drift");
  }
  const verifiedFence = await client.query("select verify_ai_content_write_fence_catalog() as verified");
  if (verifiedFence.rows[0]?.verified !== true) throw new Error("cutover_075_transaction_fence_invalid");
  const liveFence = await readFenceSecurityCatalog(client, cutover.roleNames, {
    ownerRoleName: "postgres",
    cutover075Applied,
    ...(cutover075Applied ? { cutover075Migration: migration } : {}),
  });
  if ((!cutover075Applied && liveFence.catalogSha256 !== cutover.enforcementCatalogSha256)
    || (cutover075Applied && liveFence.stableCoreSha256 !== cutover.enforcementStableCoreSha256)) {
    throw new Error("cutover_075_transaction_enforcement_catalog_drift");
  }
  const liveEvents = await readCanonicalEventTriggerCatalog(client);
  if (liveEvents.catalogSha256 !== cutover.eventTriggerCatalogSha256
    || liveEvents.count !== cutover.eventTriggerCatalogCount) {
    throw new Error("cutover_075_transaction_event_trigger_drift");
  }
  if (cutover075Applied && !exactHex(liveFence.post075Catalog?.catalogSha256, 64)) {
    throw new Error("cutover_075_transaction_post_catalog_missing");
  }
  const post075ProtectedObjectCatalogSha256 = cutover075Applied
    ? hashPost075ProtectedObjectCatalog({
      bootstrapObjectRows: liveBootstrapCatalogs.objectRows,
      controlRelations: liveFence.controlRelations,
    })
    : null;
  // Keep the persisted field name for the existing 074 status/accessor ABI. Body evidence v3
  // defines it as the combined protected-object catalog, not the bootstrap-only v7 hash.
  if (cutover075Applied && cutover.post075BootstrapObjectCatalogSha256 !== undefined
    && post075ProtectedObjectCatalogSha256 !== cutover.post075BootstrapObjectCatalogSha256) {
    throw new Error("cutover_075_recovery_post_bootstrap_object_catalog_mismatch");
  }
  return {
    ...cutover,
    ...(cutover075Applied ? {
      post075CatalogSha256: liveFence.post075Catalog.catalogSha256,
      post075BootstrapObjectCatalogSha256: post075ProtectedObjectCatalogSha256,
    } : {}),
  };
}

export async function executeAtomicCutoverMigration({ client, migration, cutover }) {
  if (migration?.id !== cutover075MigrationId || !exactHex(migration?.checksum, 64)
    || typeof migration?.sql !== "string" || !cutover
    || !exactUuid(cutover.cutoverId)
    || typeof cutover.bypassToken !== "string" || cutover.bypassToken.length === 0
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(cutover.expectedDatabaseRole ?? "")
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(cutover.schemaOwnerRoleName ?? "")
    || cutover.allowlistAuthorization?.migrationSha256 !== migration.checksum
    || cutover.allowlistAuthorization?.migrationId !== migration.id
    || cutover.allowlistAuthorization?.cutoverId !== cutover.cutoverId
    || !cutover.sealed074Context?.bootstrap074 || !cutover.sealed074Context?.migration074
    || !cutover.roleNames || !exactHex(cutover.roleCatalogSha256, 64)
    || !exactHex(cutover.eventTriggerCatalogSha256, 64)
    || !Number.isInteger(cutover.eventTriggerCatalogCount)
    || !exactHex(cutover.sealedBootstrapEnvelopeSha256, 64)
    || !exactHex(cutover.allowlistRowsSha256, 64)
    || !cutoverPreflightConfigValid(cutover, migration.checksum)
    || ["allowlistAuthorizationSha256", "allowlistAttestationSha256", "enforcementCatalogSha256",
      "enforcementStableCoreSha256",
      "provider074AttestationSha256"].some((field) => !exactHex(cutover[field], 64))) {
    throw new Error("cutover_075_config_invalid");
  }
  await client.query("begin");
  try {
    await client.query("select set_config('app.ai_content_cutover_id',$1,true)", [cutover.cutoverId]);
    await client.query("select set_config('app.ai_content_cutover_token',$1,true)", [cutover.bypassToken]);
    await client.query("select set_config('app.ai_content_migration_id',$1,true)", [migration.id]);
    const bypass = await client.query("select ai_content_cutover_bypass_allowed() as allowed");
    if (bypass.rows[0]?.allowed !== true) throw new Error("cutover_075_transaction_revalidation_failed");
    const authoritativeCutover = await revalidateAtomicCutoverDatabaseState({ client, migration, cutover });
    await client.query(`set local role ${quoteIdentifier(authoritativeCutover.schemaOwnerRoleName)}`);
    await client.query(unwrapFileTransaction(migration.sql));
    await client.query("reset role");
    const verifiedPostCutover = await revalidateAtomicCutoverDatabaseState({
      client, migration, cutover: authoritativeCutover, cutover075Applied: true,
    });
    const bodyEvidence = buildCutoverBodyEvidence(migration, verifiedPostCutover);
    await client.query(`set local role ${quoteIdentifier(authoritativeCutover.schemaOwnerRoleName)}`);
    await client.query(
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      [migration.id, migration.checksum],
    );
    await client.query("reset role");
    const transition = await client.query(
      `select transition_ai_content_cutover_status(
        $1,'maintenance_verified','migration_body_complete',$2,null,null,null,null,$3
      ) as event_sha256`,
      [cutover.cutoverId, bodyEvidence.evidenceSha256,
        verifiedPostCutover.post075BootstrapObjectCatalogSha256],
    );
    const statusEventSha256 = transition.rows[0]?.event_sha256;
    if (!exactHex(statusEventSha256, 64)) throw new Error("cutover_075_status_evidence_invalid");
    await client.query("commit");
    return {
      cutoverId: cutover.cutoverId,
      migrationId: migration.id,
      status: "migration_body_complete",
      post075CatalogSha256: verifiedPostCutover.post075CatalogSha256,
      post075BootstrapObjectCatalogSha256: verifiedPostCutover.post075BootstrapObjectCatalogSha256,
      bodyEvidenceSha256: bodyEvidence.evidenceSha256,
      statusEventSha256,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export function validatePersistedCutoverBodyEvidenceRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1
    || !exactHex(rows[0]?.evidence_sha256, 64)
    || !exactHex(rows[0]?.post_075_bootstrap_object_catalog_sha256, 64)
    || !exactHex(rows[0]?.event_sha256, 64)) {
    throw new Error("cutover_075_recovery_body_evidence_missing");
  }
  return {
    evidenceSha256: rows[0].evidence_sha256,
    post075BootstrapObjectCatalogSha256:
      rows[0].post_075_bootstrap_object_catalog_sha256,
    statusEventSha256: rows[0].event_sha256,
  };
}

async function readPersistedCutoverBodyEvidence(client, cutoverId) {
  const result = await client.query(
    "select * from public.read_ai_content_cutover_migration_body_evidence($1)",
    [cutoverId],
  );
  return validatePersistedCutoverBodyEvidenceRows(result.rows);
}

export async function recoverAtomicCutoverMigration({ client, migration, cutover }) {
  if (migration?.id !== cutover075MigrationId || !exactHex(migration?.checksum, 64)
    || !cutover || !exactUuid(cutover.cutoverId)
    || typeof cutover.bypassToken !== "string" || cutover.bypassToken.length === 0
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(cutover.expectedDatabaseRole ?? "")
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(cutover.schemaOwnerRoleName ?? "")
    || cutover.allowlistAuthorization?.migrationSha256 !== migration.checksum
    || cutover.allowlistAuthorization?.migrationId !== migration.id
    || cutover.allowlistAuthorization?.cutoverId !== cutover.cutoverId
    || !cutover.sealed074Context?.bootstrap074 || !cutover.sealed074Context?.migration074
    || !cutover.roleNames || !exactHex(cutover.roleCatalogSha256, 64)
    || !exactHex(cutover.eventTriggerCatalogSha256, 64)
    || !Number.isInteger(cutover.eventTriggerCatalogCount)
    || !exactHex(cutover.sealedBootstrapEnvelopeSha256, 64)
    || !exactHex(cutover.allowlistRowsSha256, 64)
    || !cutoverPreflightConfigValid(cutover, migration.checksum)
    || ["allowlistAuthorizationSha256", "allowlistAttestationSha256", "enforcementCatalogSha256",
      "enforcementStableCoreSha256",
      "provider074AttestationSha256"].some((field) => !exactHex(cutover[field], 64))) {
    throw new Error("cutover_075_recovery_config_invalid");
  }
  await client.query("begin");
  try {
    await client.query("select set_config('app.ai_content_cutover_id',$1,true)", [cutover.cutoverId]);
    await client.query("select set_config('app.ai_content_cutover_token',$1,true)", [cutover.bypassToken]);
    await client.query("select set_config('app.ai_content_migration_id',$1,true)", [migration.id]);
    const persistedBodyEvidence = await readPersistedCutoverBodyEvidence(client, cutover.cutoverId);
    const authoritativeCutover = await revalidateAtomicCutoverDatabaseState({
      client, migration,
      cutover: {
        ...cutover,
        post075BootstrapObjectCatalogSha256:
          persistedBodyEvidence.post075BootstrapObjectCatalogSha256,
      },
      cutover075Applied: true,
    });
    const bodyEvidence = buildCutoverBodyEvidence(migration, authoritativeCutover);
    if (bodyEvidence.evidenceSha256 !== persistedBodyEvidence.evidenceSha256) {
      throw new Error("cutover_075_recovery_body_evidence_mismatch");
    }
    const transition = await client.query(
      `select transition_ai_content_cutover_status(
        $1,'maintenance_verified','migration_body_complete',$2,null,null,null,null,$3
      ) as event_sha256`,
      [cutover.cutoverId, bodyEvidence.evidenceSha256,
        authoritativeCutover.post075BootstrapObjectCatalogSha256],
    );
    const statusEventSha256 = transition.rows[0]?.event_sha256;
    if (!exactHex(statusEventSha256, 64)
      || statusEventSha256 !== persistedBodyEvidence.statusEventSha256) {
      throw new Error("cutover_075_recovery_status_evidence_invalid");
    }
    await client.query("commit");
    return {
      cutoverId: cutover.cutoverId,
      migrationId: migration.id,
      status: "migration_body_complete",
      post075CatalogSha256: authoritativeCutover.post075CatalogSha256,
      post075BootstrapObjectCatalogSha256: authoritativeCutover.post075BootstrapObjectCatalogSha256,
      bodyEvidenceSha256: bodyEvidence.evidenceSha256,
      statusEventSha256,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function runMigrationsWithClient({
  client,
  migrations,
  baselineUpTo,
  dryRun = false,
  bootstrap074,
  bootstrap074Prerequisite,
  bootstrap074PrerequisiteMode = false,
  bootstrap074PrerequisiteProviderRoleName,
  cutover,
}) {
  const hasProtectedBootstrapSource = migrations.some((migration) => [
    legacyTriggerSearchPathMigrationId, bootstrap074MigrationId,
  ].includes(migration.id));
  const providerPrerequisiteMode = bootstrap074PrerequisiteMode === true;
  if (providerPrerequisiteMode) {
    validateBootstrap074PrerequisiteProviderRoleName(bootstrap074PrerequisiteProviderRoleName);
  }
  if (!dryRun && hasProtectedBootstrapSource && !providerPrerequisiteMode) {
    const roleNames = bootstrap074?.authorization ?? bootstrap074Prerequisite;
    const requiredRoleNameKeys = ["schemaOwnerRoleName", "applicationRoleName", "operatorRoleName",
      "migrationRoleName", "cleanupRoleName"];
    if (!roleNames || requiredRoleNameKeys.some((key) => typeof roleNames[key] !== "string")) {
      throw new Error("bootstrap_role_environment_required");
    }
    await readCanonicalBootstrapRoleCatalog(client, roleNames);
  }
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
    const exactFullSourceManifest = isExactFullSourceManifest(migrations);
    let history;
    let plan;
    let fullSource074Stage = false;
    let fullSource075Stage = false;
    if (contains074) {
      const historyTable = await client.query("select to_regclass('public.schema_migrations') as relation");
      if (!historyTable.rows[0]?.relation) throw new Error("bootstrap_074_pending_set_invalid");
      history = await readHistory(client);
      if (history.some((migration) => migration.id === cutover075MigrationId) && !cutover) {
        throw new Error("bootstrap_075_present_forbidden");
      }
      plan = buildMigrationPlan(migrations, history);
      const pendingIds = plan.pending.map((migration) => migration.id);
      const applying074 = pendingIds.includes(bootstrap074MigrationId);
      const exact074Pending = pendingIds.length === 1 && pendingIds[0] === bootstrap074MigrationId;
      const exact073aThen074Pending = pendingIds.length === 2
        && pendingIds[0] === legacyTriggerSearchPathMigrationId
        && pendingIds[1] === bootstrap074MigrationId;
      const exact073aThen074Then075Pending = pendingIds.length === 3
        && pendingIds[0] === legacyTriggerSearchPathMigrationId
        && pendingIds[1] === bootstrap074MigrationId
        && pendingIds[2] === cutover075MigrationId;
      const prerequisiteOnlyPhase = exact073aThen074Pending || exact073aThen074Then075Pending;
      fullSource074Stage = exactFullSourceManifest
        && pendingIds.length === 2
        && pendingIds[0] === bootstrap074MigrationId
        && pendingIds[1] === cutover075MigrationId;
      fullSource075Stage = exactFullSourceManifest
        && pendingIds.length === 1
        && pendingIds[0] === cutover075MigrationId;
      if (migrations.some((migration) => migration.id === cutover075MigrationId)
        && !cutover && !prerequisiteOnlyPhase && !fullSource074Stage && !fullSource075Stage) {
        throw new Error("bootstrap_075_present_forbidden");
      }
      if ((applying074 && !exact074Pending && !prerequisiteOnlyPhase && !fullSource074Stage)
        || (!applying074 && pendingIds.length !== 0
          && !fullSource075Stage
          && (!cutover || pendingIds.length !== 1 || pendingIds[0] !== cutover075MigrationId))) {
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
    const prerequisiteMigration = plan.pending.find(
      (migration) => migration.id === legacyTriggerSearchPathMigrationId,
    );
    const mustRestartBefore074 = Boolean(prerequisiteMigration
      && plan.pending.some((migration) => migration.id === bootstrap074MigrationId));
    if (mustRestartBefore074) {
      if (bootstrap074PrerequisiteMode !== true) {
        throw new Error("bootstrap_074_prerequisite_required");
      }
      if (prerequisiteMigration.id !== legacyTriggerSearchPathMigrationId
        || prerequisiteMigration.checksum !== legacyTriggerSearchPathMigrationChecksum) {
        throw new Error("bootstrap_074_prerequisite_source_invalid");
      }
      const ownerRoleName = await readLegacyTriggerSearchPathProviderOwner(
        client,
        bootstrap074PrerequisiteProviderRoleName,
      );
      await client.query("begin");
      try {
        await client.query(unwrapFileTransaction(prerequisiteMigration.sql));
        await client.query(
          "insert into schema_migrations (id, checksum) values ($1, $2)",
          [prerequisiteMigration.id, prerequisiteMigration.checksum],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
      return {
        migrations,
        pending: [prerequisiteMigration.id],
        baselineRequired: false,
        bootstrap074RestartRequired: true,
        bootstrap074PrerequisiteMigrationId: prerequisiteMigration.id,
        bootstrap074PrerequisiteProviderRoleName: ownerRoleName,
      };
    }
    let authorization;
    let liveCatalogs;
    let providerInstallRequest;
    let revocationRequest;
    let eventTriggerCatalog;
    let fenceSecurityCatalog;
    let cutoverResult;
    let bootstrap074Stage;
    let providerAttestationConsumedThisRun = false;
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
    const pending075 = plan.pending.find((migration) => migration.id === cutover075MigrationId);
    const migration075 = migrations.find((migration) => migration.id === cutover075MigrationId);
    const deferPending075 = fullSource074Stage || (fullSource075Stage && !cutover);
    const recovering075 = Boolean(cutover && migration075
      && history.some((migration) => migration.id === cutover075MigrationId) && !pending075);
    if (pending075 && !contains074) {
      throw new Error("cutover_075_requires_074_source_and_history");
    }
    if (pending075 && !bootstrap074?.authorization) {
      throw new Error("cutover_075_sealed_074_authorization_required");
    }
    const preparedCutover = pending075 && !deferPending075
      ? await verifyCutover075Preconditions({ client, migration: pending075, cutover, bootstrap074, migration074 })
      : recovering075
        ? await verifyCutover075Preconditions({ client, migration: migration075, cutover, bootstrap074, migration074, recovery: true })
        : undefined;
    for (const migration of plan.pending) {
      if (migration.id === cutover075MigrationId) {
        continue;
      }
      await client.query("begin");
      try {
        if (migration.id === bootstrap074MigrationId) {
          if (containsEventTriggerDdl(migration.sql)) throw new Error("bootstrap_074_event_trigger_ddl_forbidden");
          await client.query(`set local role ${quoteIdentifier(authorization.schemaOwnerRoleName)}`);
          await assertBootstrapSessionEnvironment(client, authorization, { afterSetRole: true });
        }
        await client.query(unwrapFileTransaction(migration.sql));
        if (migration.id === bootstrap074MigrationId) {
          const appRole = quoteIdentifier(authorization.applicationRoleName);
          const operatorRole = quoteIdentifier(authorization.operatorRoleName);
          const migrationRole = quoteIdentifier(authorization.migrationRoleName);
          const schemaOwnerRole = quoteIdentifier(authorization.schemaOwnerRoleName);
          await client.query(`revoke all on table ai_content_cutovers,ai_content_cutover_status_events,ai_content_maintenance_state,ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog from ${appRole}`);
          await client.query(`grant select on table ai_content_maintenance_state to ${appRole}`);
          await client.query(`grant execute on function assert_ai_content_writable() to ${appRole}`);
          await client.query(`grant execute on function prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text),read_ai_content_cutover_control_state(uuid),set_ai_content_maintenance(uuid,boolean),transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text,text) to ${operatorRole}`);
          await client.query(`grant select on table ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog to ${migrationRole}`);
          await client.query(`grant select on table ai_content_bootstrap_state to ${schemaOwnerRole}`);
          await client.query(`grant execute on function ai_content_cutover_bypass_allowed(),lock_ai_content_cutover_transaction_state(uuid),verify_ai_content_cutover_preflight_identity(uuid,jsonb,text,text),verify_ai_content_write_fence_catalog(),consume_ai_content_provider_attestation(),read_ai_content_cutover_migration_body_evidence(uuid),register_ai_content_075_fence_relations() to ${migrationRole}`);
          await client.query(`grant execute on function register_ai_content_075_fence_relations() to ${schemaOwnerRole}`);
          await client.query(`grant execute on function transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text,text) to ${migrationRole}`);
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
                      or has_function_privilege(app.rolname,'public.prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamp with time zone,text,text,jsonb,text,text,text,text)','EXECUTE')
                      or has_function_privilege(app.rolname,'public.read_ai_content_cutover_control_state(uuid)','EXECUTE')
                      or has_function_privilege(app.rolname,'public.set_ai_content_maintenance(uuid,boolean)','EXECUTE')
                      or has_function_privilege(app.rolname,'public.transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamp with time zone,text,text)','EXECUTE')
                      or has_function_privilege(app.rolname,'public.read_ai_content_cutover_migration_body_evidence(uuid)','EXECUTE')
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
          bootstrap074Stage = "provider_install_required";
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
      liveCatalogs = recovering075
        ? await readCanonicalBootstrapRoleCatalog(client, authorization)
        : await readCanonicalBootstrapCatalogs(client, authorization);
      if (authorization.roleCatalogSha256 !== liveCatalogs.roleCatalogSha256
        || (!recovering075
          && authorization.objectCatalogSha256 !== liveCatalogs.objectCatalogSha256)) {
        throw new Error("bootstrap_074_live_catalog_mismatch");
      }
      await client.query("select verify_ai_content_write_fence_catalog()");
      eventTriggerCatalog = await readCanonicalEventTriggerCatalog(client);
      if (sealed.provider_attestation_sha256) {
        fenceSecurityCatalog = await readFenceSecurityCatalog(client, authorization, {
          ownerRoleName: "postgres",
          cutover075Applied: recovering075,
          ...(recovering075 ? { cutover075Migration: migration075 } : {}),
        });
        const expectedStableCoreSha256 = hashFenceSecurityStableCore(
          providerInstallRequest.expectedFinalFenceSecurityCatalog,
        );
        if ((!recovering075
            && (fenceSecurityCatalog.catalogSha256 !== providerInstallRequest.expectedFinalFenceSecurityCatalogSha256
              || fenceSecurityCatalog.canonicalJson !== JSON.stringify(providerInstallRequest.expectedFinalFenceSecurityCatalog)))
          || (recovering075 && fenceSecurityCatalog.stableCoreSha256 !== expectedStableCoreSha256)
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
          providerAttestationConsumedThisRun = true;
          bootstrap074Stage = "provider_evidence_consumed";
        } else {
          bootstrap074Stage = "provider_evidence_already_consumed";
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
        bootstrap074Stage = "provider_install_required";
      }
    }
    if (fullSource075Stage && !cutover
      && bootstrap074Stage === "provider_evidence_already_consumed"
      && !bootstrap074?.allowConsumedRecovery) {
      throw new Error("cutover_075_config_required");
    }
    if (pending075 && !deferPending075) {
      cutoverResult = await executeAtomicCutoverMigration({
        client,
        migration: pending075,
        cutover: preparedCutover,
      });
    } else if (recovering075) {
      cutoverResult = await recoverAtomicCutoverMigration({
        client,
        migration: migration075,
        cutover: preparedCutover,
      });
    }
    return {
      migrations,
      pending: deferPending075
        ? plan.pending.filter((migration) => migration.id !== cutover075MigrationId).map((migration) => migration.id)
        : plan.pending.map((migration) => migration.id),
      baselineRequired: false,
      ...(deferPending075 ? {
        bootstrap074RestartRequired: true,
        bootstrap074Stage: bootstrap074Stage
          ?? (providerAttestationConsumedThisRun ? "provider_evidence_consumed" : "provider_install_required"),
        cutover075Deferred: true,
      } : {}),
      ...(providerInstallRequest ? { providerInstallRequest } : {}),
      ...(revocationRequest ? { revocationRequest } : {}),
      ...(cutoverResult ? { cutover: cutoverResult } : {}),
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
  bootstrap074Prerequisite,
  bootstrap074PrerequisiteMode = false,
  bootstrap074PrerequisiteProviderRoleName,
  cutover,
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
      bootstrap074Prerequisite,
      bootstrap074PrerequisiteMode,
      bootstrap074PrerequisiteProviderRoleName,
      cutover,
    });
  } finally {
    await client.end();
  }
}
