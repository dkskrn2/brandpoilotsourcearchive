#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-120}"
MODE=""
PROMOTION_BACKUP_METADATA="${PROMOTION_BACKUP_METADATA:-}"

if [[ $# -eq 1 && "$1" == "--prepare" ]]; then
  MODE="prepare"
elif [[ $# -eq 2 && "$1" == "--commit" && "$2" == "--dns-cutover-confirmed" ]]; then
  MODE="commit"
elif [[ $# -eq 1 && "$1" == "--commit" ]]; then
  fail "dns_cutover_confirmation_required"
else
  fail "usage_promote_prepare_or_commit_dns_cutover_confirmed"
fi

for command_name in awk docker flock sha256sum sync; do
  require_command "$command_name"
done
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"
reconcile_transition_or_fail "$ROOT" "$READY_TIMEOUT_SECONDS"

load_required_state_sha "$ROOT/state/candidate" CANDIDATE_SHA
validate_release_directory "$ROOT/releases/$CANDIDATE_SHA"
CANDIDATE_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
require_digest_image "$CANDIDATE_API_IMAGE"
CANDIDATE_CADDY_IMAGE="${RELEASE_MANIFEST[CADDY_IMAGE]}"
CANDIDATE_CANARY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
CANDIDATE_PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
CANDIDATE_ACME_EMAIL="${RELEASE_MANIFEST[ACME_EMAIL]}"

CURRENT_SHA=""
CURRENT_API_IMAGE=""
CURRENT_CADDY_IMAGE=""
CURRENT_CANARY_HOST=""
CURRENT_PRIMARY_HOST=""
if load_optional_state_sha "$ROOT/state/current" CURRENT_SHA; then
  validate_release_directory "$ROOT/releases/$CURRENT_SHA"
  CURRENT_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
  CURRENT_CADDY_IMAGE="${RELEASE_MANIFEST[CADDY_IMAGE]}"
  CURRENT_CANARY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
  CURRENT_PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
fi

ORIGINAL_PREVIOUS_SHA=""
ORIGINAL_PREVIOUS_EXISTS=false
if load_optional_state_sha "$ROOT/state/previous" ORIGINAL_PREVIOUS_SHA; then
  ORIGINAL_PREVIOUS_EXISTS=true
  validate_release_directory "$ROOT/releases/$ORIGINAL_PREVIOUS_SHA"
fi

validate_release_directory "$ROOT/releases/$CANDIDATE_SHA"
CANDIDATE_DIR="$ROOT/releases/$CANDIDATE_SHA"
if [[ -n "$CURRENT_SHA" ]]; then
  require_matching_host_pair \
    "$CURRENT_CANARY_HOST" "$CURRENT_PRIMARY_HOST" \
    "$CANDIDATE_CANARY_HOST" "$CANDIDATE_PRIMARY_HOST" \
    "promotion_hosts_mismatch"
fi
export PRIMARY_API_IMAGE="$CANDIDATE_API_IMAGE"
export CANDIDATE_API_IMAGE
export CADDY_IMAGE="$CANDIDATE_CADDY_IMAGE"
export CADDYFILE_PATH="$CANDIDATE_DIR/Caddyfile"
compose=(docker compose -p brand-pilot -f "$CANDIDATE_DIR/compose.production.yml" --env-file "$CANDIDATE_DIR/release.env")

validate_promotion_backup_metadata() {
  local path="$1"
  local line key value required_key
  local candidate_manifest_checksum external_env_checksum
  declare -A metadata=()
  [[ -n "$path" ]] || fail "promotion_backup_metadata_required"
  require_secure_state_file "$path"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail "promotion_backup_metadata_invalid"
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$key" in
      BACKUP_SCHEMA|PROVIDER_BACKUP_ID|CADDY_BACKUP_ID|CADDY_DATA_SHA256|CURRENT_RELEASE_SHA|CURRENT_IMAGE_DIGEST|CANDIDATE_RELEASE_SHA|RELEASE_MANIFEST_SHA256|EXTERNAL_ENV_SHA256) ;;
      *) fail "promotion_backup_metadata_invalid" ;;
    esac
    [[ ! -v "metadata[$key]" && -n "$value" ]] || fail "promotion_backup_metadata_invalid"
    metadata["$key"]="$value"
  done < "$path"
  for required_key in BACKUP_SCHEMA PROVIDER_BACKUP_ID CADDY_BACKUP_ID CADDY_DATA_SHA256 CURRENT_RELEASE_SHA CURRENT_IMAGE_DIGEST CANDIDATE_RELEASE_SHA RELEASE_MANIFEST_SHA256 EXTERNAL_ENV_SHA256; do
    [[ -v "metadata[$required_key]" ]] || fail "promotion_backup_metadata_invalid"
  done
  [[ "${metadata[BACKUP_SCHEMA]}" == "1" ]] || fail "promotion_backup_metadata_invalid"
  [[ "${metadata[CURRENT_RELEASE_SHA]}" == "${CURRENT_SHA:-NONE}" ]] ||
    fail "promotion_backup_current_release_mismatch"
  [[ "${metadata[CURRENT_IMAGE_DIGEST]}" == "${CURRENT_API_IMAGE:-NONE}" ]] ||
    fail "promotion_backup_current_image_mismatch"
  [[ "${metadata[CANDIDATE_RELEASE_SHA]}" == "$CANDIDATE_SHA" ]] ||
    fail "promotion_backup_candidate_mismatch"
  [[ "${metadata[CADDY_DATA_SHA256]}" =~ ^[a-f0-9]{64}$ ]] ||
    fail "promotion_backup_metadata_invalid"
  candidate_manifest_checksum="$(sha256sum -- "$CANDIDATE_DIR/release.env" | awk '{print $1}')"
  [[ "${metadata[RELEASE_MANIFEST_SHA256]}" == "$candidate_manifest_checksum" ]] ||
    fail "promotion_backup_manifest_mismatch"
  require_file_mode_600 "${RELEASE_MANIFEST[API_ENV_FILE]}"
  external_env_checksum="$(sha256sum -- "${RELEASE_MANIFEST[API_ENV_FILE]}" | awk '{print $1}')"
  [[ "${metadata[EXTERNAL_ENV_SHA256]}" == "$external_env_checksum" ]] ||
    fail "promotion_backup_env_mismatch"
}

validate_promotion_backup_metadata "$PROMOTION_BACKUP_METADATA"

verify_local_release_images() {
  local revision
  revision="$(docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$CANDIDATE_API_IMAGE")"
  [[ "$revision" == "$CANDIDATE_SHA" ]] || fail "api_image_revision_mismatch"
  docker image inspect "$CANDIDATE_CADDY_IMAGE" >/dev/null ||
    fail "caddy_image_missing"
}

validate_production_caddy_offline() {
  docker run --rm --pull never --network none \
    --env "CANARY_HOST=$CANDIDATE_CANARY_HOST" \
    --env "PRIMARY_HOST=$CANDIDATE_PRIMARY_HOST" \
    --env "ACME_EMAIL=$CANDIDATE_ACME_EMAIL" \
    --volume "$CANDIDATE_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
    --entrypoint caddy "$CANDIDATE_CADDY_IMAGE" \
    validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
}

if [[ "$MODE" == "prepare" ]]; then
  "${compose[@]}" config --quiet >/dev/null
  "${compose[@]}" pull api-primary caddy
  verify_local_release_images
  validate_production_caddy_offline

  PRIMARY_ATTEMPTED=false
  recover_failed_prepare() {
    local exit_code="$?"
    trap - EXIT
    if [[ "$exit_code" -ne 0 && "$PRIMARY_ATTEMPTED" == "true" ]]; then
      if ! "${compose[@]}" stop api-primary >/dev/null 2>&1 ||
        ! "${compose[@]}" rm -f api-primary >/dev/null 2>&1; then
        printf 'error=recovery_failed\n' >&2
        exit 70
      fi
    fi
    exit "$exit_code"
  }
  trap recover_failed_prepare EXIT

  if [[ -z "$CURRENT_SHA" ]]; then
    state_value_or_none "$ROOT/state/current" TRANSITION_CURRENT
    state_value_or_none "$ROOT/state/candidate" TRANSITION_CANDIDATE
    state_value_or_none "$ROOT/state/previous" TRANSITION_PREVIOUS
    prepared_state_flag "$ROOT/state/prepared" TRANSITION_PREPARED
    begin_transition "$ROOT" "promote" "production" "prepare_runtime" \
      "$TRANSITION_CURRENT" "$TRANSITION_CANDIDATE" "$TRANSITION_PREVIOUS" \
      "$TRANSITION_PREPARED" "$CANDIDATE_SHA"
    PRIMARY_ATTEMPTED=true
    "${compose[@]}" up -d --no-deps --pull never --wait \
      --wait-timeout "$READY_TIMEOUT_SECONDS" api-primary
  fi
  write_prepared_proof "$ROOT/state/prepared" "$CANDIDATE_DIR"
  if [[ -e "$ROOT/state/transition.journal" || -L "$ROOT/state/transition.journal" ]]; then
    remove_state_file "$ROOT/state/transition.journal"
  fi
  trap - EXIT
  status_ok "promotion_prepare"
  exit 0
fi

validate_prepared_proof "$ROOT/state/prepared" "$CANDIDATE_DIR"
"${compose[@]}" config --quiet >/dev/null
verify_local_release_images

state_value_or_none "$ROOT/state/current" TRANSITION_CURRENT
state_value_or_none "$ROOT/state/candidate" TRANSITION_CANDIDATE
state_value_or_none "$ROOT/state/previous" TRANSITION_PREVIOUS
prepared_state_flag "$ROOT/state/prepared" TRANSITION_PREPARED
begin_transition "$ROOT" "promote" "production" "runtime_mutation" \
  "$TRANSITION_CURRENT" "$TRANSITION_CANDIDATE" "$TRANSITION_PREVIOUS" \
  "$TRANSITION_PREPARED" "$CANDIDATE_SHA"

PRIMARY_ATTEMPTED=false
CADDY_ATTEMPTED=false
RUNTIME_STATE_COMMITTED=false
PREVIOUS_STATE_WRITTEN=false
recover_failed_promotion() {
  local exit_code="$?"
  trap - EXIT
  if [[ "$exit_code" -ne 0 ]]; then
    reconcile_transition_or_fail "$ROOT" "$READY_TIMEOUT_SECONDS"
  fi
  exit "$exit_code"
}
trap recover_failed_promotion EXIT

PRIMARY_ATTEMPTED=true
"${compose[@]}" up -d --no-deps --pull never --wait \
  --wait-timeout "$READY_TIMEOUT_SECONDS" api-primary
CADDY_ATTEMPTED=true
"${compose[@]}" up -d --no-deps --pull never caddy
wait_for_url "https://${CANDIDATE_PRIMARY_HOST}/ready" "$READY_TIMEOUT_SECONDS" ||
  fail "candidate_primary_not_ready"

if [[ "$CURRENT_SHA" != "$CANDIDATE_SHA" ]]; then
  if [[ -n "$CURRENT_SHA" ]]; then
    atomic_write_state "$ROOT/state/previous" "${CURRENT_SHA}"$'\n'
    PREVIOUS_STATE_WRITTEN=true
  fi
  atomic_write_state "$ROOT/state/current" "${CANDIDATE_SHA}"$'\n'
fi
RUNTIME_STATE_COMMITTED=true
rm -f -- "$ROOT/state/candidate" || fail "candidate_state_cleanup_failed"
rm -f -- "$ROOT/state/prepared" || fail "prepared_state_cleanup_failed"
sync -f -- "$ROOT/state" || fail "state_file_cleanup_failed"
[[ ! -e "$ROOT/state/candidate" && ! -L "$ROOT/state/candidate" &&
  ! -e "$ROOT/state/prepared" && ! -L "$ROOT/state/prepared" ]] ||
  fail "state_commit_mismatch"
load_required_state_sha "$ROOT/state/current" COMMITTED_CURRENT_SHA
[[ "$COMMITTED_CURRENT_SHA" == "$CANDIDATE_SHA" ]] || fail "state_commit_mismatch"
remove_state_file "$ROOT/state/transition.journal"
trap - EXIT
status_ok "promotion_commit"
