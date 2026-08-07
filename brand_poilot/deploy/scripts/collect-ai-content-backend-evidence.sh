#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() {
  printf 'error=%s\n' "${1:-ai_content_backend_evidence_failed}" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "ai_content_backend_required_command_missing"
}

require_release_sha() {
  [[ "$1" =~ ^[a-f0-9]{40}$ ]] || fail "ai_content_backend_release_invalid"
}

require_digest_image() {
  [[ "$1" =~ ^[a-zA-Z0-9._-]+(:[0-9]+)?(/[a-zA-Z0-9._-]+)+@sha256:[a-f0-9]{64}$ ]] ||
    fail "ai_content_backend_image_invalid"
}

require_uuid() {
  [[ "$1" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] ||
    fail "ai_content_backend_cutover_id_invalid"
}

require_absolute_path() {
  [[ "$1" =~ ^/[a-zA-Z0-9._/-]+$ ]] || fail "ai_content_backend_path_invalid"
}

require_secure_directory() {
  local directory="$1"
  require_absolute_path "$directory"
  [[ -d "$directory" && ! -L "$directory" ]] || fail "ai_content_backend_directory_invalid"
  [[ "$(realpath -e -- "$directory")" == "$directory" ]] || fail "ai_content_backend_directory_invalid"
  [[ "$(stat -c '%a' -- "$directory")" == "700" ]] || fail "ai_content_backend_directory_mode_invalid"
  [[ "$(stat -c '%U' -- "$directory")" == "$FILE_OWNER" ]] || fail "ai_content_backend_directory_owner_invalid"
}

require_owned_directory() {
  local directory="$1"
  local mode
  require_absolute_path "$directory"
  [[ -d "$directory" && ! -L "$directory" ]] || fail "ai_content_backend_directory_invalid"
  [[ "$(realpath -e -- "$directory")" == "$directory" ]] || fail "ai_content_backend_directory_invalid"
  mode="$(stat -c '%a' -- "$directory")"
  [[ "$mode" == "700" || "$mode" == "750" ]] || fail "ai_content_backend_directory_mode_invalid"
  [[ "$(stat -c '%U' -- "$directory")" == "$FILE_OWNER" ]] || fail "ai_content_backend_directory_owner_invalid"
}

require_secure_file() {
  local file="$1"
  require_absolute_path "$file"
  [[ -f "$file" && ! -L "$file" ]] || fail "ai_content_backend_file_invalid"
  [[ "$(realpath -e -- "$file")" == "$file" ]] || fail "ai_content_backend_file_invalid"
  [[ "$(stat -c '%a' -- "$file")" == "600" ]] || fail "ai_content_backend_file_mode_invalid"
  [[ "$(stat -c '%U' -- "$file")" == "$FILE_OWNER" ]] || fail "ai_content_backend_file_owner_invalid"
}

require_one_line() {
  local value="$1"
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] ||
    fail "ai_content_backend_single_line_invalid"
}

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
FILE_OWNER="${AI_CONTENT_BACKEND_EVIDENCE_FILE_OWNER:-bpdeploy}"
require_absolute_path "$ROOT"

declare -A OPTION=()
while [[ $# -gt 0 ]]; do
  [[ "$1" == --* && $# -ge 2 ]] || fail "ai_content_backend_arguments_invalid"
  option_key="${1#--}"
  [[ "$option_key" =~ ^[a-z0-9-]+$ && ! -v "OPTION[$option_key]" ]] ||
    fail "ai_content_backend_arguments_invalid"
  OPTION["$option_key"]="$2"
  shift 2
done
readonly -a REQUIRED_OPTIONS=(release operator-url-file cutover-id output)
[[ "${#OPTION[@]}" -eq "${#REQUIRED_OPTIONS[@]}" ]] || fail "ai_content_backend_arguments_invalid"
for option_key in "${REQUIRED_OPTIONS[@]}"; do
  [[ -v "OPTION[$option_key]" && -n "${OPTION[$option_key]}" ]] ||
    fail "ai_content_backend_argument_missing"
done

for command_name in awk basename cat chmod dirname docker flock grep id mktemp mv realpath rmdir rm sha256sum stat timeout; do
  require_command "$command_name"
done
CODEX_RUNTIME_UID="$(id -u "$FILE_OWNER")" || fail "ai_content_backend_runtime_identity_invalid"
CODEX_RUNTIME_GID="$(id -g "$FILE_OWNER")" || fail "ai_content_backend_runtime_identity_invalid"
[[ "$CODEX_RUNTIME_UID" =~ ^[0-9]+$ && "$CODEX_RUNTIME_GID" =~ ^[0-9]+$ ]] ||
  fail "ai_content_backend_runtime_identity_invalid"
(( CODEX_RUNTIME_UID > 0 && CODEX_RUNTIME_GID > 0 )) ||
  fail "ai_content_backend_runtime_identity_invalid"
export CODEX_RUNTIME_UID CODEX_RUNTIME_GID

RELEASE_SHA="${OPTION[release]}"
CUTOVER_ID="${OPTION[cutover-id]}"
OPERATOR_URL_FILE="${OPTION[operator-url-file]}"
OUTPUT_FILE="${OPTION[output]}"
require_release_sha "$RELEASE_SHA"
require_uuid "$CUTOVER_ID"
require_absolute_path "$OPERATOR_URL_FILE"
require_absolute_path "$OUTPUT_FILE"

require_owned_directory "$ROOT"
STATE_DIR="$ROOT/state"
require_owned_directory "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"

CURRENT_FILE="$STATE_DIR/current"
ACTIVE_CUTOVER_FILE="$STATE_DIR/ai-content-cutover-id"
require_secure_file "$CURRENT_FILE"
require_secure_file "$ACTIVE_CUTOVER_FILE"
CURRENT_SHA="$(<"$CURRENT_FILE")"
ACTIVE_CUTOVER_ID="$(<"$ACTIVE_CUTOVER_FILE")"
require_one_line "$CURRENT_SHA"
require_one_line "$ACTIVE_CUTOVER_ID"
require_release_sha "$CURRENT_SHA"
require_uuid "$ACTIVE_CUTOVER_ID"
[[ "$CURRENT_SHA" == "$RELEASE_SHA" ]] || fail "ai_content_backend_current_release_mismatch"
[[ "$ACTIVE_CUTOVER_ID" == "$CUTOVER_ID" ]] || fail "ai_content_backend_active_cutover_mismatch"

RELEASE_DIR="$ROOT/releases/$RELEASE_SHA"
require_owned_directory "$ROOT/releases"
require_secure_directory "$RELEASE_DIR"
MANIFEST="$RELEASE_DIR/release.env"
MANIFEST_CHECKSUM="$RELEASE_DIR/release.env.sha256"
COMPOSE_FILE="$RELEASE_DIR/compose.production.yml"
require_secure_file "$MANIFEST"
require_secure_file "$MANIFEST_CHECKSUM"
[[ -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" ]] || fail "ai_content_backend_compose_invalid"
[[ "$(realpath -e -- "$COMPOSE_FILE")" == "$COMPOSE_FILE" ]] || fail "ai_content_backend_compose_invalid"

checksum_line="$(<"$MANIFEST_CHECKSUM")"
require_one_line "$checksum_line"
[[ "$checksum_line" =~ ^([a-f0-9]{64})[[:space:]][[:space:]]release\.env$ ]] ||
  fail "ai_content_backend_manifest_checksum_invalid"
[[ "$(sha256sum -- "$MANIFEST" | awk '{print $1}')" == "${BASH_REMATCH[1]}" ]] ||
  fail "ai_content_backend_manifest_checksum_invalid"

declare -A MANIFEST_VALUE=()
while IFS= read -r manifest_line || [[ -n "$manifest_line" ]]; do
  [[ -z "$manifest_line" ]] && continue
  [[ "$manifest_line" != *$'\r'* && "$manifest_line" =~ ^([A-Z][A-Z0-9_]*)=(.+)$ ]] ||
    fail "ai_content_backend_manifest_invalid"
  manifest_key="${BASH_REMATCH[1]}"
  manifest_value="${BASH_REMATCH[2]}"
  [[ ! -v "MANIFEST_VALUE[$manifest_key]" ]] || fail "ai_content_backend_manifest_invalid"
  MANIFEST_VALUE["$manifest_key"]="$manifest_value"
done < "$MANIFEST"
for manifest_key in RELEASE_SCHEMA RELEASE_SHA API_ENV_FILE; do
  [[ -v "MANIFEST_VALUE[$manifest_key]" ]] || fail "ai_content_backend_manifest_invalid"
done
[[ "${MANIFEST_VALUE[RELEASE_SCHEMA]}" == "3" ]] || fail "ai_content_backend_release_schema_invalid"
[[ "${MANIFEST_VALUE[RELEASE_SHA]}" == "$RELEASE_SHA" ]] || fail "ai_content_backend_release_manifest_mismatch"

readonly -a COMPONENT_KEYS=(
  API
  CONTENT_PROPOSAL_WORKER
  IMAGE_WORKER
  CARD_NEWS_WORKER
  BLOG_WORKER
  REEL_WORKER
)
for component_key in "${COMPONENT_KEYS[@]}"; do
  image_key="${component_key}_IMAGE"
  revision_key="${component_key}_SOURCE_SHA"
  changed_key="${component_key}_CHANGED"
  [[ -v "MANIFEST_VALUE[$image_key]" && -v "MANIFEST_VALUE[$revision_key]" &&
    -v "MANIFEST_VALUE[$changed_key]" ]] || fail "ai_content_backend_component_manifest_invalid"
  require_digest_image "${MANIFEST_VALUE[$image_key]}"
  require_release_sha "${MANIFEST_VALUE[$revision_key]}"
  [[ "${MANIFEST_VALUE[$changed_key]}" == "true" || "${MANIFEST_VALUE[$changed_key]}" == "false" ]] ||
    fail "ai_content_backend_component_manifest_invalid"
  if [[ "${MANIFEST_VALUE[$changed_key]}" == "true" ]]; then
    [[ "${MANIFEST_VALUE[$revision_key]}" == "$RELEASE_SHA" ]] ||
      fail "ai_content_backend_component_revision_invalid"
  fi
done

API_ENV_FILE="$ROOT/shared/env/api.env"
APPLICATION_DATABASE_URL_FILE="$ROOT/shared/secrets/ai-content-application-database-url"
RESTORE_EVIDENCE_FILE="$STATE_DIR/ai-content-cutovers/$CUTOVER_ID/finalize-post-075/shared-owner-restore/evidence.json"
[[ "${MANIFEST_VALUE[API_ENV_FILE]}" == "$API_ENV_FILE" ]] || fail "ai_content_backend_api_env_path_invalid"
require_owned_directory "$ROOT/shared"
require_secure_directory "$ROOT/shared/env"
require_secure_directory "$ROOT/shared/secrets"
require_secure_file "$API_ENV_FILE"
require_secure_file "$APPLICATION_DATABASE_URL_FILE"
require_secure_file "$OPERATOR_URL_FILE"
require_secure_file "$RESTORE_EVIDENCE_FILE"
grep -q '"contractVersion":"ai-content-shared-owner-restore-evidence.v1"' "$RESTORE_EVIDENCE_FILE" ||
  fail "ai_content_backend_shared_owner_restore_evidence_invalid"
RESTORE_EVIDENCE_SHA256="$(sha256sum -- "$RESTORE_EVIDENCE_FILE" | awk '{print $1}')"
[[ "$RESTORE_EVIDENCE_SHA256" =~ ^[a-f0-9]{64}$ ]] ||
  fail "ai_content_backend_shared_owner_restore_evidence_invalid"

OUTPUT_DIRECTORY="$(dirname -- "$OUTPUT_FILE")"
require_secure_directory "$OUTPUT_DIRECTORY"
[[ ! -e "$OUTPUT_FILE" && ! -L "$OUTPUT_FILE" ]] || fail "ai_content_backend_output_exists"
OUTPUT_NAME="$(basename -- "$OUTPUT_FILE")"
OUTPUT_TEMP=""

TEMP_DIR="$(mktemp -d "$STATE_DIR/.ai-content-backend-evidence.XXXXXX")"
readonly CONTROL_STATUS_FILE="$TEMP_DIR/control-status.json"
readonly DB_IDENTITY_SCRIPT="$TEMP_DIR/db-identity.mjs"
readonly HTTP_PROBE_SCRIPT="$TEMP_DIR/http-probe.mjs"
readonly BODY_FILE="$TEMP_DIR/backend-body.json"
readonly EXPECTED_FILE="$TEMP_DIR/backend-expected.json"
readonly SEALED_FILE="$TEMP_DIR/backend-sealed.json"

cleanup_backend_temp() {
  if [[ -n "${OUTPUT_TEMP:-}" && "$OUTPUT_TEMP" == "$OUTPUT_DIRECTORY"/."$OUTPUT_NAME".tmp.* &&
    -f "$OUTPUT_TEMP" && ! -L "$OUTPUT_TEMP" ]]; then
    rm -f -- "$OUTPUT_TEMP"
  fi
  if [[ -n "${TEMP_DIR:-}" && "$TEMP_DIR" == "$STATE_DIR"/.ai-content-backend-evidence.* &&
    -d "$TEMP_DIR" && ! -L "$TEMP_DIR" ]]; then
    rm -f -- "$CONTROL_STATUS_FILE" "$DB_IDENTITY_SCRIPT" "$HTTP_PROBE_SCRIPT" \
      "$BODY_FILE" "$EXPECTED_FILE" "$SEALED_FILE"
    rmdir -- "$TEMP_DIR" 2>/dev/null || true
  fi
}
trap cleanup_backend_temp EXIT
chmod 0700 -- "$TEMP_DIR"
require_secure_directory "$TEMP_DIR"

secure_empty_file() {
  local file="$1"
  [[ "$file" == "$TEMP_DIR"/* && ! -e "$file" && ! -L "$file" ]] ||
    fail "ai_content_backend_temp_file_invalid"
  : > "$file"
  chmod 0600 -- "$file"
  require_secure_file "$file"
}

for temporary_file in "$CONTROL_STATUS_FILE" "$DB_IDENTITY_SCRIPT" "$HTTP_PROBE_SCRIPT" \
  "$BODY_FILE" "$EXPECTED_FILE" "$SEALED_FILE"; do
  secure_empty_file "$temporary_file"
done

cat > "$DB_IDENTITY_SCRIPT" <<'EOF_DB_IDENTITY'
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  decodeCaCertificate,
  resolveVerifiedTlsConfig,
} from "/app/scripts/databaseTls.mjs";

const require = createRequire("/app/package.json");
const { Client } = require("pg");
const fail = () => {
  process.stderr.write("ai_content_backend_database_identity_probe_failed\n");
  process.exit(1);
};
try {
  const file = "/run/secrets/ai_content_application_database_url";
  const connectionString = readFileSync(file, "utf8").trim();
  const parsed = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !parsed.hostname || !parsed.username || !parsed.password || /\s/u.test(connectionString)) fail();
  const client = new Client({
    ...resolveVerifiedTlsConfig(connectionString, {
      caCertificate: decodeCaCertificate(process.env.DB_SSL_CA_BASE64),
    }),
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    const result = await client.query("select session_user,current_user");
    const identity = result.rows[0];
    if (result.rows.length !== 1 || identity?.session_user !== "content_application"
      || identity?.current_user !== "content_application") fail();
    process.stdout.write('{"databaseCurrentUser":"content_application","databaseSessionUser":"content_application"}\n');
  } finally {
    await client.end();
  }
} catch {
  fail();
}
EOF_DB_IDENTITY

cat > "$HTTP_PROBE_SCRIPT" <<'EOF_HTTP_PROBE'
const fail = () => {
  process.stderr.write("ai_content_backend_http_probe_failed\n");
  process.exit(1);
};
const exactKeys = (value, keys) => value !== null && typeof value === "object"
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
try {
  const kind = process.env.PROBE_KIND;
  const apiService = process.env.PROBE_API_SERVICE;
  const serviceName = process.env.PROBE_SERVICE_NAME;
  const path = process.env.PROBE_PATH;
  if (!["api-canary", "api-primary"].includes(apiService)
    || !["ready", "heartbeat", "claim"].includes(kind)
    || !serviceName || !path?.startsWith("/")) fail();
  const init = kind === "ready" ? {
    signal: AbortSignal.timeout(10_000),
  } : {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env[process.env.PROBE_TOKEN_NAME] ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workerId: serviceName,
      ...(kind === "claim" ? { leaseSeconds: 30 } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  };
  if (kind !== "ready" && !["WORKER_API_TOKEN", "CONTENT_PROPOSAL_WORKER_API_TOKEN"]
    .includes(process.env.PROBE_TOKEN_NAME)) fail();
  const response = await fetch(`http://127.0.0.1:4000${path}`, init);
  const observedAt = new Date().toISOString();
  if (kind === "ready") {
    if (response.status !== 200) fail();
    process.stdout.write(`${JSON.stringify({ observedAt, readiness: "ready", serviceName: apiService })}\n`);
  } else {
    const text = await response.text();
    if (text.length < 2 || text.length > 1_024) fail();
    let body;
    try { body = JSON.parse(text); } catch { fail(); }
    const observedStatus = kind === "heartbeat" ? "heartbeat_verified" : "ai_content_maintenance_503";
    if (kind === "heartbeat") {
      if (response.status !== 200 || !exactKeys(body, ["workerId"]) || body.workerId !== serviceName) fail();
    } else if (response.status !== 503 || !exactKeys(body, ["error"])
      || body.error !== "ai_content_maintenance") fail();
    process.stdout.write(`${JSON.stringify({ apiService, observedAt, observedStatus, serviceName })}\n`);
  }
} catch {
  fail();
}
EOF_HTTP_PROBE
chmod 0600 -- "$DB_IDENTITY_SCRIPT" "$HTTP_PROBE_SCRIPT"
require_secure_file "$DB_IDENTITY_SCRIPT"
require_secure_file "$HTTP_PROBE_SCRIPT"

API_IMAGE="${MANIFEST_VALUE[API_IMAGE]}"
API_SOURCE_SHA="${MANIFEST_VALUE[API_SOURCE_SHA]}"
[[ "$(docker image inspect --format '{{.Config.User}}' "$API_IMAGE" 2>/dev/null)" == "node" ]] ||
  fail "ai_content_backend_api_image_user_invalid"
[[ "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$API_IMAGE" 2>/dev/null)" == "$API_SOURCE_SHA" ]] ||
  fail "ai_content_backend_image_revision_invalid"

readonly -a SECURE_DOCKER_RUN=(
  timeout --signal=TERM --kill-after=5s 45s
  docker run --rm --pull never --read-only
  --user "$(id -u):$(id -g)"
  --cap-drop ALL --security-opt no-new-privileges
  --pids-limit 64 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m
)

read_control_status() {
  "${SECURE_DOCKER_RUN[@]}" \
    --env-file "$API_ENV_FILE" \
    --entrypoint node \
    --mount "type=bind,src=$OPERATOR_URL_FILE,dst=/run/secrets/operator-database-url,readonly" \
    "$API_IMAGE" /app/scripts/ai-content-cutover-control.mjs --status \
    --database-url-file /run/secrets/operator-database-url --cutover-id "$CUTOVER_ID"
}

CONTROL_STATUS="$(read_control_status)" || fail "ai_content_backend_control_status_failed"
require_one_line "$CONTROL_STATUS"
EXPECTED_CONTROL_STATUS="{\"activeCutoverCount\":1,\"activeCutoverId\":\"$CUTOVER_ID\",\"cleanupCredentialRevokedAt\":null,\"cleanupRevocationEvidenceSha256\":null,\"cutoverId\":\"$CUTOVER_ID\",\"maintenanceCutoverId\":\"$CUTOVER_ID\",\"maintenanceEnabled\":true,\"markerPresent\":true,\"status\":\"migration_body_complete\"}"
[[ "$CONTROL_STATUS" == "$EXPECTED_CONTROL_STATUS" ]] || fail "ai_content_backend_control_state_invalid"
printf '%s\n' "$CONTROL_STATUS" > "$CONTROL_STATUS_FILE"
chmod 0600 -- "$CONTROL_STATUS_FILE"
require_secure_file "$CONTROL_STATUS_FILE"

readonly -a API_SERVICES=(api-canary api-primary)
readonly -a WORKER_SERVICES=(
  content-proposal-worker-1
  image-worker-1
  card-news-worker-1
  blog-worker-1
  reel-worker-1
)
declare -A SERVICE_IMAGE_KEY=(
  [api-canary]=API_IMAGE
  [api-primary]=API_IMAGE
  [content-proposal-worker-1]=CONTENT_PROPOSAL_WORKER_IMAGE
  [image-worker-1]=IMAGE_WORKER_IMAGE
  [card-news-worker-1]=CARD_NEWS_WORKER_IMAGE
  [blog-worker-1]=BLOG_WORKER_IMAGE
  [reel-worker-1]=REEL_WORKER_IMAGE
)
declare -A SERVICE_REVISION_KEY=(
  [api-canary]=API_SOURCE_SHA
  [api-primary]=API_SOURCE_SHA
  [content-proposal-worker-1]=CONTENT_PROPOSAL_WORKER_SOURCE_SHA
  [image-worker-1]=IMAGE_WORKER_SOURCE_SHA
  [card-news-worker-1]=CARD_NEWS_WORKER_SOURCE_SHA
  [blog-worker-1]=BLOG_WORKER_SOURCE_SHA
  [reel-worker-1]=REEL_WORKER_SOURCE_SHA
)
declare -A CONTAINER_ID=()

compose_container_id() {
  local service="$1"
  local -a compose_ids=()
  local -a compose=(
    docker compose -p brand-pilot -f "$COMPOSE_FILE" --env-file "$MANIFEST"
  )
  if [[ "$service" == *-worker-1 ]]; then
    compose+=(--profile "$service")
  fi
  mapfile -t compose_ids < <("${compose[@]}" ps -a -q "$service")
  [[ "${#compose_ids[@]}" -eq 1 && "${compose_ids[0]}" =~ ^[a-f0-9]{12,64}$ ]] ||
    fail "ai_content_backend_container_identity_invalid"
  printf '%s' "${compose_ids[0]}"
}

verify_container() {
  local service="$1"
  local container_id="$2"
  local image_key="${SERVICE_IMAGE_KEY[$service]}"
  local revision_key="${SERVICE_REVISION_KEY[$service]}"
  local expected_image="${MANIFEST_VALUE[$image_key]}"
  local expected_revision="${MANIFEST_VALUE[$revision_key]}"
  local expected_config_id
  expected_config_id="$(docker image inspect --format '{{.Id}}' "$expected_image" 2>/dev/null)" ||
    fail "ai_content_backend_image_inspect_failed"
  [[ "$expected_config_id" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "ai_content_backend_image_config_invalid"
  [[ "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$expected_image" 2>/dev/null)" == "$expected_revision" ]] ||
    fail "ai_content_backend_image_revision_invalid"
  [[ "$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null)" == "$expected_image" ]] ||
    fail "ai_content_backend_container_image_invalid"
  [[ "$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null)" == "$expected_config_id" ]] ||
    fail "ai_content_backend_container_config_invalid"
  [[ "$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null)" == "running" ]] ||
    fail "ai_content_backend_container_not_running"
  [[ "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container_id" 2>/dev/null)" == "$expected_revision" ]] ||
    fail "ai_content_backend_container_revision_invalid"
  [[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id" 2>/dev/null)" == "brand-pilot" ]] ||
    fail "ai_content_backend_container_project_invalid"
  [[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$container_id" 2>/dev/null)" == "$service" ]] ||
    fail "ai_content_backend_container_service_invalid"
}

for service in "${API_SERVICES[@]}" "${WORKER_SERVICES[@]}"; do
  CONTAINER_ID["$service"]="$(compose_container_id "$service")"
  verify_container "$service" "${CONTAINER_ID[$service]}"
done

for service in "${API_SERVICES[@]}"; do
  container_id="${CONTAINER_ID[$service]}"
  [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null)" == "healthy" ]] ||
    fail "ai_content_backend_api_health_invalid"
  mapfile -t database_path_lines < <(
    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null |
      grep '^AI_CONTENT_DATABASE_URL_FILE=' || true
  )
  [[ "${#database_path_lines[@]}" -eq 1 &&
    "${database_path_lines[0]}" == "AI_CONTENT_DATABASE_URL_FILE=/run/secrets/ai_content_application_database_url" ]] ||
    fail "ai_content_backend_application_secret_env_invalid"
  mapfile -t application_mount_lines < <(
    docker inspect --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/ai_content_application_database_url"}}{{printf "%s|%s|%t|%s" .Source .Destination .RW .Type}}{{end}}{{end}}' \
      "$container_id" 2>/dev/null
  )
  [[ "${#application_mount_lines[@]}" -eq 1 &&
    "${application_mount_lines[0]}" == "$APPLICATION_DATABASE_URL_FILE|/run/secrets/ai_content_application_database_url|false|bind" ]] ||
    fail "ai_content_backend_application_secret_mount_invalid"
done

run_database_identity_probe() {
  local api_service="$1"
  local identity
  identity="$("${SECURE_DOCKER_RUN[@]}" \
    --env-file "$API_ENV_FILE" \
    --env "PROBE_API_SERVICE=$api_service" \
    --entrypoint node \
    --mount "type=bind,src=$APPLICATION_DATABASE_URL_FILE,dst=/run/secrets/ai_content_application_database_url,readonly" \
    --mount "type=bind,src=$DB_IDENTITY_SCRIPT,dst=/run/input/db-identity.mjs,readonly" \
    "$API_IMAGE" /run/input/db-identity.mjs)" || fail "ai_content_backend_database_identity_invalid"
  [[ "$identity" == '{"databaseCurrentUser":"content_application","databaseSessionUser":"content_application"}' ]] ||
    fail "ai_content_backend_database_identity_invalid"
}

run_http_probe() {
  local api_service="$1"
  local probe_kind="$2"
  local service_name="$3"
  local probe_path="$4"
  local token_name="$5"
  "${SECURE_DOCKER_RUN[@]}" \
    --network "container:${CONTAINER_ID[$api_service]}" \
    --env-file "$API_ENV_FILE" \
    --env "PROBE_API_SERVICE=$api_service" \
    --env "PROBE_KIND=$probe_kind" \
    --env "PROBE_SERVICE_NAME=$service_name" \
    --env "PROBE_PATH=$probe_path" \
    --env "PROBE_TOKEN_NAME=$token_name" \
    --entrypoint node \
    --mount "type=bind,src=$HTTP_PROBE_SCRIPT,dst=/run/input/http-probe.mjs,readonly" \
    "$API_IMAGE" /run/input/http-probe.mjs
}

declare -A API_VERIFIED_AT=()
for service in "${API_SERVICES[@]}"; do
  run_database_identity_probe "$service"
  ready_observation="$(run_http_probe "$service" ready "$service" /ready WORKER_API_TOKEN)" ||
    fail "ai_content_backend_api_ready_probe_failed"
  require_one_line "$ready_observation"
  ready_pattern='^\{"observedAt":"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z)","readiness":"ready","serviceName":"([a-z0-9-]+)"\}$'
  [[ "$ready_observation" =~ $ready_pattern && "${BASH_REMATCH[2]}" == "$service" ]] ||
    fail "ai_content_backend_api_ready_probe_invalid"
  API_VERIFIED_AT["$service"]="${BASH_REMATCH[1]}"
done

declare -A WORKER_PATH=(
  [content-proposal-worker-1]='/worker/content-proposal-jobs/heartbeat'
  [image-worker-1]='/worker/ai-content-render-jobs/claim'
  [card-news-worker-1]='/worker/ai-content-jobs/card_news/claim'
  [blog-worker-1]='/worker/ai-content-jobs/blog/claim'
  [reel-worker-1]='/worker/ai-content-jobs/reel/claim'
)
declare -A WORKER_KIND=(
  [content-proposal-worker-1]=heartbeat
  [image-worker-1]=claim
  [card-news-worker-1]=claim
  [blog-worker-1]=claim
  [reel-worker-1]=claim
)
declare -A WORKER_TOKEN_NAME=(
  [content-proposal-worker-1]=CONTENT_PROPOSAL_WORKER_API_TOKEN
  [image-worker-1]=WORKER_API_TOKEN
  [card-news-worker-1]=WORKER_API_TOKEN
  [blog-worker-1]=WORKER_API_TOKEN
  [reel-worker-1]=WORKER_API_TOKEN
)
declare -A WORKER_OBSERVED_AT=()
declare -A WORKER_OBSERVATION_SHA256=()
overall_verified_at=""
for worker_service in "${WORKER_SERVICES[@]}"; do
  canary_observation="$(run_http_probe api-canary "${WORKER_KIND[$worker_service]}" \
    "$worker_service" "${WORKER_PATH[$worker_service]}" "${WORKER_TOKEN_NAME[$worker_service]}")" ||
    fail "ai_content_backend_worker_probe_failed"
  primary_observation="$(run_http_probe api-primary "${WORKER_KIND[$worker_service]}" \
    "$worker_service" "${WORKER_PATH[$worker_service]}" "${WORKER_TOKEN_NAME[$worker_service]}")" ||
    fail "ai_content_backend_worker_probe_failed"
  require_one_line "$canary_observation"
  require_one_line "$primary_observation"
  expected_observed_status="ai_content_maintenance_503"
  [[ "$worker_service" == "content-proposal-worker-1" ]] && expected_observed_status="heartbeat_verified"
  observation_pattern='^\{"apiService":"(api-canary|api-primary)","observedAt":"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z)","observedStatus":"([a-z0-9_]+)","serviceName":"([a-z0-9_-]+)"\}$'
  [[ "$canary_observation" =~ $observation_pattern && "${BASH_REMATCH[1]}" == "api-canary" &&
    "${BASH_REMATCH[3]}" == "$expected_observed_status" && "${BASH_REMATCH[4]}" == "$worker_service" ]] ||
    fail "ai_content_backend_worker_observation_invalid"
  [[ "$primary_observation" =~ $observation_pattern && "${BASH_REMATCH[1]}" == "api-primary" &&
    "${BASH_REMATCH[3]}" == "$expected_observed_status" && "${BASH_REMATCH[4]}" == "$worker_service" ]] ||
    fail "ai_content_backend_worker_observation_invalid"
  WORKER_OBSERVED_AT["$worker_service"]="${BASH_REMATCH[2]}"
  overall_verified_at="${BASH_REMATCH[2]}"
  canonical_observation="{\"apiServices\":[$canary_observation,$primary_observation],\"contractVersion\":\"ai-content-backend-observation.v1\",\"serviceName\":\"$worker_service\"}"
  WORKER_OBSERVATION_SHA256["$worker_service"]="$(printf '%s' "$canonical_observation" | sha256sum | awk '{print $1}')"
  [[ "${WORKER_OBSERVATION_SHA256[$worker_service]}" =~ ^[a-f0-9]{64}$ ]] ||
    fail "ai_content_backend_worker_observation_invalid"
done
[[ -n "$overall_verified_at" ]] || fail "ai_content_backend_verified_at_invalid"

CONTROL_STATUS_AFTER="$(read_control_status)" || fail "ai_content_backend_control_status_failed"
[[ "$CONTROL_STATUS_AFTER" == "$EXPECTED_CONTROL_STATUS" ]] || fail "ai_content_backend_control_state_changed"

api_rows=""
for service in "${API_SERVICES[@]}"; do
  image_key="${SERVICE_IMAGE_KEY[$service]}"
  image_digest="${MANIFEST_VALUE[$image_key]##*@}"
  row="{\"databaseCurrentUser\":\"content_application\",\"databaseSessionUser\":\"content_application\",\"health\":\"healthy\",\"imageDigest\":\"$image_digest\",\"readiness\":\"ready\",\"serviceName\":\"$service\",\"verifiedAt\":\"${API_VERIFIED_AT[$service]}\"}"
  [[ -z "$api_rows" ]] && api_rows="$row" || api_rows="$api_rows,$row"
done

worker_rows=""
for service in "${WORKER_SERVICES[@]}"; do
  image_key="${SERVICE_IMAGE_KEY[$service]}"
  image_digest="${MANIFEST_VALUE[$image_key]##*@}"
  verification_kind="authenticated_claim_maintenance_fence"
  observed_status="ai_content_maintenance_503"
  if [[ "$service" == "content-proposal-worker-1" ]]; then
    verification_kind="maintenance_safe_idle_heartbeat"
    observed_status="heartbeat_verified"
  fi
  row="{\"imageDigest\":\"$image_digest\",\"observationEvidenceSha256\":\"${WORKER_OBSERVATION_SHA256[$service]}\",\"observedAt\":\"${WORKER_OBSERVED_AT[$service]}\",\"observedStatus\":\"$observed_status\",\"serviceName\":\"$service\",\"verificationKind\":\"$verification_kind\"}"
  [[ -z "$worker_rows" ]] && worker_rows="$row" || worker_rows="$worker_rows,$row"
done

printf '%s\n' \
  "{\"apiServices\":[$api_rows],\"candidateReleaseSha\":\"$RELEASE_SHA\",\"contractVersion\":\"ai-content-backend-verification-evidence.v1\",\"cutoverId\":\"$CUTOVER_ID\",\"maintenanceEnabled\":true,\"sharedOwnerRestoreEvidenceSha256\":\"$RESTORE_EVIDENCE_SHA256\",\"verifiedAt\":\"$overall_verified_at\",\"workers\":[$worker_rows]}" \
  > "$BODY_FILE"

printf '%s\n' \
  "{\"candidateReleaseSha\":\"$RELEASE_SHA\",\"cutoverId\":\"$CUTOVER_ID\",\"imageDigests\":{\"api-canary\":\"${MANIFEST_VALUE[API_IMAGE]##*@}\",\"api-primary\":\"${MANIFEST_VALUE[API_IMAGE]##*@}\",\"blog-worker-1\":\"${MANIFEST_VALUE[BLOG_WORKER_IMAGE]##*@}\",\"card-news-worker-1\":\"${MANIFEST_VALUE[CARD_NEWS_WORKER_IMAGE]##*@}\",\"content-proposal-worker-1\":\"${MANIFEST_VALUE[CONTENT_PROPOSAL_WORKER_IMAGE]##*@}\",\"image-worker-1\":\"${MANIFEST_VALUE[IMAGE_WORKER_IMAGE]##*@}\",\"reel-worker-1\":\"${MANIFEST_VALUE[REEL_WORKER_IMAGE]##*@}\"},\"sharedOwnerRestoreEvidenceSha256\":\"$RESTORE_EVIDENCE_SHA256\"}" \
  > "$EXPECTED_FILE"
chmod 0600 -- "$BODY_FILE" "$EXPECTED_FILE"
require_secure_file "$BODY_FILE"
require_secure_file "$EXPECTED_FILE"

SEALED_EVIDENCE="$("${SECURE_DOCKER_RUN[@]}" \
  --entrypoint node \
  --mount "type=bind,src=$BODY_FILE,dst=/run/input/backend-body.json,readonly" \
  --mount "type=bind,src=$EXPECTED_FILE,dst=/run/input/backend-expected.json,readonly" \
  "$API_IMAGE" /app/scripts/ai-content-cutover-control.mjs --create-backend-evidence \
  --body-file /run/input/backend-body.json --expected-file /run/input/backend-expected.json)" ||
  fail "ai_content_backend_evidence_seal_failed"
require_one_line "$SEALED_EVIDENCE"
[[ "$SEALED_EVIDENCE" == *"\"contractVersion\":\"ai-content-backend-verification-evidence.v1\""* &&
  "$SEALED_EVIDENCE" == *"\"cutoverId\":\"$CUTOVER_ID\""* ]] ||
  fail "ai_content_backend_evidence_seal_invalid"
printf '%s\n' "$SEALED_EVIDENCE" > "$SEALED_FILE"
chmod 0600 -- "$SEALED_FILE"
require_secure_file "$SEALED_FILE"

OUTPUT_TEMP="$(mktemp "$OUTPUT_DIRECTORY/.${OUTPUT_NAME}.tmp.XXXXXX")"
chmod 0600 -- "$OUTPUT_TEMP"
printf '%s\n' "$SEALED_EVIDENCE" > "$OUTPUT_TEMP"
chmod 0600 -- "$OUTPUT_TEMP"
if ! mv -n -- "$OUTPUT_TEMP" "$OUTPUT_FILE" || [[ -e "$OUTPUT_TEMP" ]]; then
  rm -f -- "$OUTPUT_TEMP"
  fail "ai_content_backend_output_write_failed"
fi
OUTPUT_TEMP=""
require_secure_file "$OUTPUT_FILE"
[[ "$(<"$OUTPUT_FILE")" == "$SEALED_EVIDENCE" ]] || fail "ai_content_backend_output_write_failed"

printf '%s\n' "ai_content_backend_evidence=ok"
