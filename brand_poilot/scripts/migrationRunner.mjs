import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
const providerAttestationContract = "ai-content-074-provider-attestation.v1";

function canonicalBootstrapAuthorization(value) {
  const keys = [
    "contractVersion", "requestId", "migrationId", "migrationSha256",
    "imageDigest", "imageSourceLabel", "roleCatalogSha256", "objectCatalogSha256",
    "migrationRoleName", "schemaOwnerRoleName", "applicationRoleName",
    "operatorRoleName", "cleanupRoleName", "eventTriggerName",
    "eventTriggerFunction", "eventTriggerFunctionSha256",
    "eventTriggerDefinitionSha256", "issuedAt", "expiresAt",
  ];
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

function hmac(value, key) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function exactHex(value, size) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${size}}$`).test(value);
}

function safeEqualHex(actual, expected) {
  if (!exactHex(actual, 64) || !exactHex(expected, 64)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function signBootstrapRoleAuthorization(authorization, signingKey) {
  if (!signingKey) throw new Error("bootstrap_role_authorization_key_required");
  return hmac(canonicalBootstrapAuthorization(authorization), signingKey);
}

export function validateBootstrapRoleAuthorization(authorization, context) {
  if (!authorization || authorization.contractVersion !== "ai-content-bootstrap-role-authorization.v1") {
    throw new Error("bootstrap_role_authorization_contract_invalid");
  }
  const expectedSignature = signBootstrapRoleAuthorization(authorization, context.signingKey);
  if (!safeEqualHex(authorization.signature, expectedSignature)) {
    throw new Error("bootstrap_role_authorization_signature_invalid");
  }
  if (context.usedRequestIds?.has(authorization.requestId)) {
    throw new Error("bootstrap_role_authorization_replayed");
  }
  const now = new Date(context.now ?? Date.now()).getTime();
  const issued = Date.parse(authorization.issuedAt);
  const expires = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now) {
    throw new Error("bootstrap_role_authorization_not_yet_valid");
  }
  if (expires < now || expires <= issued || expires-issued > 15*60*1000) {
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
  const roles = [authorization.schemaOwnerRoleName, authorization.applicationRoleName,
    authorization.operatorRoleName, authorization.migrationRoleName, authorization.cleanupRoleName];
  if (roles.some((role) => typeof role !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(role))
    || new Set(roles).size !== roles.length) {
    throw new Error("bootstrap_role_authorization_roles_invalid");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(authorization.eventTriggerName)
    || !/^[A-Za-z_][A-Za-z0-9_.]{0,126}$/.test(authorization.eventTriggerFunction)
    || !exactHex(authorization.eventTriggerFunctionSha256, 64)
    || !exactHex(authorization.eventTriggerDefinitionSha256, 64)) {
    throw new Error("bootstrap_role_authorization_event_trigger_invalid");
  }
  return authorization;
}

function canonicalProviderAttestation(value) {
  const keys = ["contractVersion", "providerRequestSha256", "authorizationRequestId",
    "action", "eventTriggerName", "eventTriggerFunction", "eventTriggerFunctionSha256",
    "eventTriggerDefinitionSha256", "eventTriggerOwner", "eventTriggerEnabled",
    "migrationId", "migrationSha256", "imageDigest", "imageSourceLabel",
    "roleCatalogSha256", "objectCatalogSha256", "issuedAt"];
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

export function buildProviderEventTriggerInstallRequest(authorization) {
  const request = {
    contractVersion: "ai-content-074-provider-install-request.v1",
    authorizationRequestId: authorization.requestId,
    action: "create_enable_verify_074_event_trigger",
    eventTriggerName: authorization.eventTriggerName,
    eventTriggerFunction: authorization.eventTriggerFunction,
    eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
    eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
    migrationId: authorization.migrationId,
    migrationSha256: authorization.migrationSha256,
    imageDigest: authorization.imageDigest,
    imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256,
    objectCatalogSha256: authorization.objectCatalogSha256,
  };
  return { ...request, requestSha256: checksum(JSON.stringify(request)) };
}

export function signProviderEventTriggerAttestation(attestation, signingKey) {
  if (!signingKey) throw new Error("provider_attestation_key_required");
  return hmac(canonicalProviderAttestation(attestation), signingKey);
}

export function validateProviderEventTriggerAttestation(attestation, { authorization, installRequest, signingKey, usedAttestationIds, now }) {
  if (!attestation || attestation.contractVersion !== providerAttestationContract) {
    throw new Error("provider_attestation_contract_invalid");
  }
  if (usedAttestationIds?.has(attestation.providerRequestSha256)) {
    throw new Error("provider_attestation_replayed");
  }
  const signature = signProviderEventTriggerAttestation(attestation, signingKey);
  if (!safeEqualHex(attestation.signature, signature)) throw new Error("provider_attestation_signature_invalid");
  const issued = Date.parse(attestation.issuedAt);
  const currentTime = new Date(now ?? Date.now()).getTime();
  if (!Number.isFinite(issued)
    || issued < Date.parse(authorization.issuedAt)
    || issued > Date.parse(authorization.expiresAt)
    || issued > currentTime) {
    throw new Error("provider_attestation_stale");
  }
  const expected = {
    providerRequestSha256: installRequest.requestSha256,
    authorizationRequestId: authorization.requestId,
    action: "create_enable_verify_074_event_trigger",
    eventTriggerName: authorization.eventTriggerName,
    eventTriggerFunction: authorization.eventTriggerFunction,
    eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
    eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
    eventTriggerOwner: "postgres",
    eventTriggerEnabled: "enabled",
    migrationId: authorization.migrationId,
    migrationSha256: authorization.migrationSha256,
    imageDigest: authorization.imageDigest,
    imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256,
    objectCatalogSha256: authorization.objectCatalogSha256,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (attestation[key] !== value) throw new Error(`provider_attestation_${key}_mismatch`);
  }
  return attestation;
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(identifier)) throw new Error("bootstrap_role_identifier_invalid");
  return `"${identifier}"`;
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
    await ensureMigrationHistory(client);
    let history = await readHistory(client);
    if (history.length === 0 && await hasExistingApplicationSchema(client)) {
      await baselineExistingSchema(client, migrations, baselineUpTo);
      history = await readHistory(client);
    }
    const plan = buildMigrationPlan(migrations, history);
    const migration074 = migrations.find((migration) => migration.id === bootstrap074MigrationId);
    let authorization;
    let providerInstallRequest;
    let providerAttestation;
    let revocationRequest;
    if (plan.pending.some((migration) => migration.id === bootstrap074MigrationId)) {
      if (!bootstrap074?.authorization) throw new Error("bootstrap_role_authorization_required");
      authorization = validateBootstrapRoleAuthorization(bootstrap074.authorization, {
        ...bootstrap074,
        migration: migration074,
      });
      const identity = await client.query("select session_user, current_user");
      if (identity.rows[0]?.session_user !== authorization.migrationRoleName
        || identity.rows[0]?.current_user !== authorization.migrationRoleName
        || identity.rows[0]?.session_user === authorization.schemaOwnerRoleName
        || identity.rows[0]?.session_user === "postgres") {
        throw new Error("bootstrap_role_session_identity_invalid");
      }
      const bootstrapRoles = await client.query(
        `select not migration.rolinherit as migration_noinherit,
                not owner.rolcanlogin as owner_nologin,
                exists (
                  select 1 from pg_auth_members membership
                   where membership.member=migration.oid and membership.roleid=owner.oid
                ) as exact_owner_membership,
                (select count(*)::integer from pg_auth_members membership
                  where membership.member=migration.oid and membership.roleid<>owner.oid) as other_memberships
           from pg_roles migration cross join pg_roles owner
          where migration.rolname=$1 and owner.rolname=$2`,
        [authorization.migrationRoleName, authorization.schemaOwnerRoleName],
      );
      const roleRow = bootstrapRoles.rows[0];
      if (!roleRow?.migration_noinherit || !roleRow?.owner_nologin
        || !roleRow?.exact_owner_membership || Number(roleRow.other_memberships)!==0) {
        throw new Error("bootstrap_role_catalog_invalid");
      }
    }
    if (plan.pending.some((migration) => migration.id === "075_ai_content_three_format_cutover.sql")) {
      throw new Error("bootstrap_075_not_supported_before_cutover_runner");
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
          await client.query(
            `insert into ai_content_bootstrap_state (
               singleton,authorization_request_id,migration_role_name,schema_owner_role_name,
               migration_sha256,role_catalog_sha256,object_catalog_sha256
             ) values (true,$1,$2,$3,$4,$5,$6)`,
            [authorization.requestId,authorization.migrationRoleName,authorization.schemaOwnerRoleName,
              authorization.migrationSha256,authorization.roleCatalogSha256,authorization.objectCatalogSha256],
          );
          await client.query(`revoke all on table ai_content_cutovers,ai_content_cutover_status_events,ai_content_maintenance_state,ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog from ${appRole}`);
          await client.query(`grant select on table ai_content_maintenance_state to ${appRole}`);
          await client.query(`grant execute on function assert_ai_content_writable() to ${appRole}`);
          await client.query(`grant execute on function prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamptz,text,text,text,text,text),set_ai_content_maintenance(uuid,boolean),transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text) to ${operatorRole}`);
          await client.query(`grant execute on function ai_content_cutover_bypass_allowed(),verify_ai_content_write_fence_catalog() to ${migrationRole}`);
          const roleSafety = await client.query(
            `select app.rolsuper as app_superuser,app.rolbypassrls as app_bypassrls,
                    app.rolinherit as app_inherit,
                    exists (
                      select 1 from pg_auth_members membership
                       where membership.member=app.oid
                         and membership.roleid in ($2::regrole,$3::regrole,$4::regrole)
                    ) as app_privileged_membership,
                    exists (
                      select 1 from public.ai_content_write_fence_catalog catalog
                      join pg_class relation on relation.oid=to_regclass('public.' || catalog.relation_name)
                       where catalog.relation_class='customer_execution' and relation.relowner=app.oid
                    ) as app_owns_fenced_relation
               from pg_roles app where app.rolname=$1`,
            [authorization.applicationRoleName, authorization.operatorRoleName,
              authorization.migrationRoleName, authorization.cleanupRoleName],
          );
          const safety = roleSafety.rows[0];
          if (!safety || safety.app_superuser || safety.app_bypassrls
            || safety.app_privileged_membership || safety.app_owns_fenced_relation) {
            throw new Error("bootstrap_074_application_role_unsafe");
          }
        }
        await client.query("insert into schema_migrations (id, checksum) values ($1, $2)", [migration.id, migration.checksum]);
        if (migration.id === bootstrap074MigrationId) {
          await client.query("select verify_ai_content_write_fence_catalog()");
          providerInstallRequest = buildProviderEventTriggerInstallRequest(authorization);
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    if (bootstrap074?.providerAttestation) {
      authorization ??= validateBootstrapRoleAuthorization(bootstrap074.authorization, {
        ...bootstrap074,
        migration: migration074,
      });
      const verifierIdentity = await client.query("select session_user, current_user");
      if (verifierIdentity.rows[0]?.session_user !== authorization.migrationRoleName
        || verifierIdentity.rows[0]?.current_user !== authorization.migrationRoleName) {
        throw new Error("bootstrap_role_session_identity_invalid");
      }
      const bootstrapState = await client.query(
        `select authorization_request_id,migration_role_name,schema_owner_role_name,
                migration_sha256,role_catalog_sha256,object_catalog_sha256
           from ai_content_bootstrap_state where singleton`,
      );
      const sealed = bootstrapState.rows[0];
      if (!sealed
        || sealed.authorization_request_id!==authorization.requestId
        || sealed.migration_role_name!==authorization.migrationRoleName
        || sealed.schema_owner_role_name!==authorization.schemaOwnerRoleName
        || sealed.migration_sha256!==authorization.migrationSha256
        || sealed.role_catalog_sha256!==authorization.roleCatalogSha256
        || sealed.object_catalog_sha256!==authorization.objectCatalogSha256) {
        throw new Error("bootstrap_074_state_mismatch");
      }
      providerInstallRequest ??= buildProviderEventTriggerInstallRequest(authorization);
      providerAttestation = validateProviderEventTriggerAttestation(bootstrap074.providerAttestation, {
        authorization,
        installRequest: providerInstallRequest,
        signingKey: bootstrap074.providerSigningKey,
        usedAttestationIds: bootstrap074.usedAttestationIds,
        now: bootstrap074.now,
      });
      const live = await client.query(
        `select e.evtname as event_trigger_name,
                owner.rolname as event_trigger_owner,
                case e.evtenabled when 'O' then 'enabled' else e.evtenabled::text end as event_trigger_enabled,
                n.nspname || '.' || p.proname as event_trigger_function,
                encode(digest(pg_get_functiondef(p.oid),'sha256'),'hex') as event_trigger_function_sha256,
                encode(digest(concat_ws('|',e.evtname,e.evtevent,e.evtenabled::text,n.nspname,p.proname),'sha256'),'hex') as event_trigger_definition_sha256
           from pg_event_trigger e
           join pg_roles owner on owner.oid=e.evtowner
           join pg_proc p on p.oid=e.evtfoid
           join pg_namespace n on n.oid=p.pronamespace
          where e.evtname=$1`,
        [authorization.eventTriggerName],
      );
      const row = live.rows[0];
      if (live.rowCount !== 1
        || row.event_trigger_owner !== "postgres"
        || row.event_trigger_enabled !== "enabled"
        || row.event_trigger_function !== authorization.eventTriggerFunction
        || row.event_trigger_function_sha256 !== authorization.eventTriggerFunctionSha256
        || row.event_trigger_definition_sha256 !== authorization.eventTriggerDefinitionSha256) {
        throw new Error("bootstrap_074_live_event_trigger_mismatch");
      }
      await client.query("select verify_ai_content_write_fence_catalog()");
      revocationRequest = {
        contractVersion: "ai-content-074-membership-revocation-request.v1",
        authorizationRequestId: authorization.requestId,
        providerRequestSha256: providerInstallRequest.requestSha256,
        migrationRoleName: authorization.migrationRoleName,
        schemaOwnerRoleName: authorization.schemaOwnerRoleName,
        evidenceSha256: checksum(canonicalProviderAttestation(providerAttestation)),
      };
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
