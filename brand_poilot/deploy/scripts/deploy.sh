#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SOURCE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-120}"
[[ $# -eq 3 && "$2" == "--phase" ]] || fail "usage_deploy_manifest_phase"
MANIFEST="$1"
PHASE="$3"
[[ "$PHASE" == "canary" ]] || fail "use_promote_for_production"

for command_name in cmp docker flock grep id install mktemp sha256sum sync; do
  require_command "$command_name"
done

POST_075_DATA_MIGRATION_ID="076_manual_content_generation_brand_rules.sql"
POST_075_DATA_MIGRATION_SHA256="da42c957d4307d58c1f37f5d508c8a1f14836727080d6290e4b0537e43167604"
POST_075_SCHEMA_MIGRATION_ID="079_publish_calendar_runtime.sql"
POST_075_SCHEMA_MIGRATION_SHA256="c46ffafa578f6c1f8bb353f4e7bc94d16033416dd5a6aa730cf81119e6e6ef61"

validate_post_075_data_migration_evidence() {
  local evidence_file="$1"
  grep -Fq '"contractVersion": "post-075-data-migration-evidence.v1"' "$evidence_file" ||
    fail "post_075_data_migration_evidence_invalid"
  grep -Fq '"providerRoleName": "postgres"' "$evidence_file" ||
    fail "post_075_data_migration_evidence_invalid"
  grep -Fq "\"migrationId\": \"$POST_075_DATA_MIGRATION_ID\"" "$evidence_file" ||
    fail "post_075_data_migration_evidence_invalid"
  grep -Fq "\"migrationSha256\": \"$POST_075_DATA_MIGRATION_SHA256\"" "$evidence_file" ||
    fail "post_075_data_migration_evidence_invalid"
  grep -Eq '"status": "(applied|already_applied)"' "$evidence_file" ||
    fail "post_075_data_migration_evidence_invalid"
}

run_post_075_data_migration_gate() {
  local state_directory="$ROOT/state/post-075-data-migrations"
  local evidence_file="$state_directory/$POST_075_DATA_MIGRATION_ID.json"
  local provider_file="${AI_CONTENT_POST_075_PROVIDER_DATABASE_URL_FILE:-}"
  local output
  local -a tls_environment=()
  if [[ -e "$evidence_file" || -L "$evidence_file" ]]; then
    require_secure_state_directory "$state_directory"
    require_file_mode_600 "$evidence_file" "${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
    validate_post_075_data_migration_evidence "$evidence_file"
    return
  fi
  [[ -n "$provider_file" ]] || fail "post_075_provider_database_url_file_required"
  require_file_mode_600 "$provider_file" "${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
  mapfile -d '' -t tls_environment < <(resolve_ai_content_floor_tls_environment "$ROOT")
  output="$(docker run --rm --pull never --read-only \
    --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m "${tls_environment[@]}" \
    --entrypoint node \
    --mount "type=bind,src=$provider_file,dst=/run/secrets/provider-admin-database-url,readonly" \
    --env SUPABASE_DATABASE_URL_FILE=/run/secrets/provider-admin-database-url \
    --env AI_CONTENT_POST_075_EXPECTED_PROVIDER_ROLE=postgres \
    "$CANDIDATE_API_IMAGE" /app/scripts/migrate.mjs --post-075-data)" ||
    fail "post_075_data_migration_failed"
  if [[ ! -e "$state_directory" && ! -L "$state_directory" ]]; then
    install -d -m 0700 "$state_directory"
  fi
  [[ -d "$state_directory" && ! -L "$state_directory" ]] ||
    fail "post_075_data_migration_state_invalid"
  require_secure_state_directory "$state_directory"
  atomic_write "$evidence_file" "${output}"$'\n' 600
  validate_post_075_data_migration_evidence "$evidence_file"
}

validate_post_075_schema_migration_evidence() {
  local evidence_file="$1"
  grep -Fq '"contractVersion": "post-075-schema-migration-evidence.v1"' "$evidence_file" ||
    fail "post_075_schema_migration_evidence_invalid"
  grep -Fq '"providerRoleName": "postgres"' "$evidence_file" ||
    fail "post_075_schema_migration_evidence_invalid"
  grep -Fq "\"migrationId\": \"$POST_075_SCHEMA_MIGRATION_ID\"" "$evidence_file" ||
    fail "post_075_schema_migration_evidence_invalid"
  grep -Fq "\"migrationSha256\": \"$POST_075_SCHEMA_MIGRATION_SHA256\"" "$evidence_file" ||
    fail "post_075_schema_migration_evidence_invalid"
  grep -Eq '"status": "(applied|already_applied)"' "$evidence_file" ||
    fail "post_075_schema_migration_evidence_invalid"
}

run_post_075_schema_migration_gate() {
  local state_directory="$ROOT/state/post-075-schema-migrations"
  local evidence_file="$state_directory/$POST_075_SCHEMA_MIGRATION_ID.json"
  local provider_file="${AI_CONTENT_POST_075_PROVIDER_DATABASE_URL_FILE:-}"
  local output
  local -a tls_environment=()
  if [[ -e "$evidence_file" || -L "$evidence_file" ]]; then
    require_secure_state_directory "$state_directory"
    require_file_mode_600 "$evidence_file" "${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
  fi
  [[ -n "$provider_file" ]] || fail "post_075_provider_database_url_file_required"
  require_file_mode_600 "$provider_file" "${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
  mapfile -d '' -t tls_environment < <(resolve_ai_content_floor_tls_environment "$ROOT")
  output="$(docker run --rm --pull never --read-only \
    --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m "${tls_environment[@]}" \
    --entrypoint node \
    --mount "type=bind,src=$provider_file,dst=/run/secrets/provider-admin-database-url,readonly" \
    --env SUPABASE_DATABASE_URL_FILE=/run/secrets/provider-admin-database-url \
    --env AI_CONTENT_POST_075_EXPECTED_PROVIDER_ROLE=postgres \
    "$CANDIDATE_API_IMAGE" /app/scripts/migrate.mjs --post-075-schema)" ||
    fail "post_075_schema_migration_failed"
  if [[ ! -e "$state_directory" && ! -L "$state_directory" ]]; then
    install -d -m 0700 "$state_directory"
  fi
  [[ -d "$state_directory" && ! -L "$state_directory" ]] ||
    fail "post_075_schema_migration_state_invalid"
  require_secure_state_directory "$state_directory"
  atomic_write "$evidence_file" "${output}"$'\n' 600
  validate_post_075_schema_migration_evidence "$evidence_file"
}

enforce_ai_content_roll_forward_floor "$ROOT"
mkdir -p -- "$ROOT/releases" "$ROOT/state"
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"
reconcile_transition_or_fail "$ROOT" "$READY_TIMEOUT_SECONDS"

validate_release_manifest "$MANIFEST"
require_worker_image_manifest
RELEASE_SHA="${RELEASE_MANIFEST[RELEASE_SHA]}"
CANDIDATE_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
RELEASE_DIR="$ROOT/releases/$RELEASE_SHA"
MARKETING_CUTOVER=false
MARKETING_RETIREMENT_RECORD_SOURCE=""
if [[ -v "RELEASE_MANIFEST[MARKETING_RETIREMENT_SHA256]" ]]; then
  MARKETING_CUTOVER=true
  MARKETING_RETIREMENT_RECORD_SOURCE="$(cd -- "$(dirname -- "$MANIFEST")" && pwd)/marketing-worker-retirement.json"
fi

CURRENT_SHA=""
CURRENT_API_IMAGE="$CANDIDATE_API_IMAGE"
CURRENT_CANARY_HOST=""
CURRENT_PRIMARY_HOST=""
if load_optional_state_sha "$ROOT/state/current" CURRENT_SHA; then
  if [[ "$MARKETING_CUTOVER" == "true" ]]; then
    validate_legacy_marketing_cutover_source "$ROOT/releases/$CURRENT_SHA"
    CURRENT_API_IMAGE="$(legacy_release_manifest_value "$ROOT/releases/$CURRENT_SHA/release.env" API_IMAGE)"
    CURRENT_CANARY_HOST="$(legacy_release_manifest_value "$ROOT/releases/$CURRENT_SHA/release.env" CANARY_HOST)"
    CURRENT_PRIMARY_HOST="$(legacy_release_manifest_value "$ROOT/releases/$CURRENT_SHA/release.env" PRIMARY_HOST)"
    require_digest_image "$CURRENT_API_IMAGE"
    require_hostname "$CURRENT_CANARY_HOST"
    require_hostname "$CURRENT_PRIMARY_HOST"
  else
    validate_state_release_directory "$ROOT" "$CURRENT_SHA"
    CURRENT_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
    CURRENT_CANARY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
    CURRENT_PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  fi
elif [[ "$MARKETING_CUTOVER" == "true" ]]; then
  fail "marketing_retirement_source_release_missing"
fi

PREVIOUS_CANDIDATE_SHA=""
PREVIOUS_CANDIDATE_API_IMAGE=""
PREVIOUS_CANDIDATE_HOST=""
PREVIOUS_CANDIDATE_PRIMARY_HOST=""
if load_optional_state_sha "$ROOT/state/candidate" PREVIOUS_CANDIDATE_SHA; then
  validate_release_directory "$ROOT/releases/$PREVIOUS_CANDIDATE_SHA"
  PREVIOUS_CANDIDATE_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
  PREVIOUS_CANDIDATE_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
  PREVIOUS_CANDIDATE_PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
fi

if [[ -e "$RELEASE_DIR" || -L "$RELEASE_DIR" ]]; then
  validate_release_directory "$RELEASE_DIR"
  cmp -s -- "$MANIFEST" "$RELEASE_DIR/release.env" || fail "immutable_release_manifest_mismatch"
else
  STAGING_DIR="$(mktemp -d "$ROOT/releases/.${RELEASE_SHA}.tmp.XXXXXX")"
  cleanup_staging() {
    rm -rf -- "$STAGING_DIR"
  }
  trap cleanup_staging EXIT
  install -m 0644 "$DEPLOY_SOURCE_DIR/compose.production.yml" "$STAGING_DIR/compose.production.yml"
  install -m 0644 "$DEPLOY_SOURCE_DIR/Caddyfile" "$STAGING_DIR/Caddyfile"
  install -m 0644 "$DEPLOY_SOURCE_DIR/Caddyfile.canary" "$STAGING_DIR/Caddyfile.canary"
  install -d -m 0755 "$STAGING_DIR/scripts"
  install -m 0755 "$DEPLOY_SOURCE_DIR"/scripts/*.sh "$STAGING_DIR/scripts/"
  install -m 0600 "$MANIFEST" "$STAGING_DIR/release.env"
  install -m 0600 "${MANIFEST}.sha256" "$STAGING_DIR/release.env.sha256"
  if [[ "$MARKETING_CUTOVER" == "true" ]]; then
    install -m 0400 "$MARKETING_RETIREMENT_RECORD_SOURCE" "$STAGING_DIR/marketing-worker-retirement.json"
  fi
  generate_release_integrity "$STAGING_DIR"
  mv -- "$STAGING_DIR" "$RELEASE_DIR"
  trap - EXIT
fi

validate_release_directory "$RELEASE_DIR"
require_worker_image_manifest
CANDIDATE_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
require_digest_image "$CANDIDATE_API_IMAGE"
CANDIDATE_CANARY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
CANDIDATE_PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
if [[ -n "$CURRENT_SHA" ]]; then
  require_matching_host_pair \
    "$CURRENT_CANARY_HOST" "$CURRENT_PRIMARY_HOST" \
    "$CANDIDATE_CANARY_HOST" "$CANDIDATE_PRIMARY_HOST"
fi
if [[ -n "$PREVIOUS_CANDIDATE_SHA" ]]; then
  require_matching_host_pair \
    "$PREVIOUS_CANDIDATE_HOST" "$PREVIOUS_CANDIDATE_PRIMARY_HOST" \
    "$CANDIDATE_CANARY_HOST" "$CANDIDATE_PRIMARY_HOST"
fi
export PRIMARY_API_IMAGE="$CURRENT_API_IMAGE"
export CANDIDATE_API_IMAGE
export CADDY_IMAGE="${RELEASE_MANIFEST[CADDY_IMAGE]}"
export DM_WORKER_IMAGE="${RELEASE_MANIFEST[DM_WORKER_IMAGE]}"
export WIKI_WORKER_IMAGE="${RELEASE_MANIFEST[WIKI_WORKER_IMAGE]}"
export CONTENT_PROPOSAL_WORKER_IMAGE="${RELEASE_MANIFEST[CONTENT_PROPOSAL_WORKER_IMAGE]}"
export BRAND_INTELLIGENCE_WORKER_IMAGE="${RELEASE_MANIFEST[BRAND_INTELLIGENCE_WORKER_IMAGE]}"
export SUBJECT_ANALYSIS_WORKER_IMAGE="${RELEASE_MANIFEST[SUBJECT_ANALYSIS_WORKER_IMAGE]}"
export IMAGE_WORKER_IMAGE="${RELEASE_MANIFEST[IMAGE_WORKER_IMAGE]}"
export CARD_NEWS_WORKER_IMAGE="${RELEASE_MANIFEST[CARD_NEWS_WORKER_IMAGE]}"
export BLOG_WORKER_IMAGE="${RELEASE_MANIFEST[BLOG_WORKER_IMAGE]}"
export REEL_WORKER_IMAGE="${RELEASE_MANIFEST[REEL_WORKER_IMAGE]}"

START_CADDY=false
if [[ -z "$CURRENT_SHA" && -z "$PREVIOUS_CANDIDATE_SHA" ]]; then
  START_CADDY=true
  export CADDYFILE_PATH="$RELEASE_DIR/Caddyfile.canary"
else
  export CADDYFILE_PATH="$RELEASE_DIR/Caddyfile"
fi
PREFLIGHT="${PREFLIGHT_SCRIPT:-$RELEASE_DIR/scripts/preflight.sh}"
BRAND_PILOT_PARENT_LOCK_FD=9 "$PREFLIGHT" "$RELEASE_DIR/release.env"
compose=(docker compose -p brand-pilot -f "$RELEASE_DIR/compose.production.yml" --env-file "$RELEASE_DIR/release.env")
"${compose[@]}" config --quiet >/dev/null
if [[ "$START_CADDY" == "true" ]]; then
  "${compose[@]}" pull api-canary caddy
else
  "${compose[@]}" pull api-canary
fi

verify_release_image_revision "$CANDIDATE_API_IMAGE" "$(release_image_source_revision API_IMAGE)"
run_post_075_data_migration_gate
run_post_075_schema_migration_gate

state_value_or_none "$ROOT/state/current" TRANSITION_CURRENT
state_value_or_none "$ROOT/state/candidate" TRANSITION_CANDIDATE
state_value_or_none "$ROOT/state/previous" TRANSITION_PREVIOUS
prepared_state_flag "$ROOT/state/prepared" TRANSITION_PREPARED
begin_transition "$ROOT" "deploy" "canary" "runtime_mutation" \
  "$TRANSITION_CURRENT" "$TRANSITION_CANDIDATE" "$TRANSITION_PREVIOUS" \
  "$TRANSITION_PREPARED" "$RELEASE_SHA"

CANDIDATE_ATTEMPTED=false
CADDY_ATTEMPTED=false
recover_failed_candidate() {
  local exit_code="$?"
  trap - EXIT
  if [[ "$exit_code" -ne 0 ]]; then
    reconcile_transition_or_fail "$ROOT" "$READY_TIMEOUT_SECONDS"
  fi
  exit "$exit_code"
}
trap recover_failed_candidate EXIT

CANDIDATE_ATTEMPTED=true
"${compose[@]}" up -d --no-deps --pull never --wait --wait-timeout "$READY_TIMEOUT_SECONDS" api-canary
if [[ "$START_CADDY" == "true" ]]; then
  CADDY_ATTEMPTED=true
  "${compose[@]}" up -d --no-deps --pull never caddy
fi
wait_for_url "https://${RELEASE_MANIFEST[CANARY_HOST]}/ready" "$READY_TIMEOUT_SECONDS" ||
  fail "external_readiness_failed"
remove_state_file "$ROOT/state/prepared"
atomic_write_state "$ROOT/state/candidate" "${RELEASE_SHA}"$'\n'
load_required_state_sha "$ROOT/state/candidate" COMMITTED_CANDIDATE_SHA
[[ "$COMMITTED_CANDIDATE_SHA" == "$RELEASE_SHA" ]] || fail "state_commit_mismatch"
remove_state_file "$ROOT/state/transition.journal"

trap - EXIT
status_ok "deployment"
