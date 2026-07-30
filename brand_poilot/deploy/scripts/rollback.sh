#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-120}"
TARGET_SHA=""
TARGET_MODE=""
PHASE=""

if [[ $# -eq 3 && "$1" == "--previous" && "$2" == "--phase" ]]; then
  TARGET_MODE="previous"
  PHASE="$3"
elif [[ $# -eq 4 && "$1" == "--release" && "$3" == "--phase" ]]; then
  TARGET_MODE="release"
  TARGET_SHA="$2"
  require_release_sha "$TARGET_SHA"
  PHASE="$4"
else
  fail "usage_rollback_target_phase"
fi
[[ "$PHASE" == "canary" || "$PHASE" == "production" ]] || fail "deployment_phase_invalid"

for command_name in docker flock sync; do
  require_command "$command_name"
done
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"
reconcile_transition_or_fail "$ROOT" "$READY_TIMEOUT_SECONDS"
if [[ "$TARGET_MODE" == "previous" ]]; then
  load_required_state_sha "$ROOT/state/previous" TARGET_SHA
fi

CURRENT_SHA=""
CURRENT_API_IMAGE=""
CURRENT_CADDY_IMAGE=""
CURRENT_CANARY_HOST=""
CURRENT_PRIMARY_HOST=""
CURRENT_API_ENV_FILE=""
if load_optional_state_sha "$ROOT/state/current" CURRENT_SHA; then
  validate_state_release_directory "$ROOT" "$CURRENT_SHA"
  CURRENT_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
  CURRENT_CADDY_IMAGE="${RELEASE_MANIFEST[CADDY_IMAGE]}"
  CURRENT_CANARY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
  CURRENT_PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  CURRENT_API_ENV_FILE="${RELEASE_MANIFEST[API_ENV_FILE]}"
fi
CANDIDATE_SHA=""
CANDIDATE_API_IMAGE=""
CANDIDATE_CANARY_HOST=""
CANDIDATE_PRIMARY_HOST=""
CANDIDATE_API_ENV_FILE=""
if load_optional_state_sha "$ROOT/state/candidate" CANDIDATE_SHA; then
  validate_state_release_directory "$ROOT" "$CANDIDATE_SHA"
  CANDIDATE_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
  CANDIDATE_CANARY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
  CANDIDATE_PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  CANDIDATE_API_ENV_FILE="${RELEASE_MANIFEST[API_ENV_FILE]}"
fi
if [[ "$PHASE" == "production" &&
  -z "$CURRENT_SHA" && -z "$CANDIDATE_SHA" ]]; then
  fail "production_rollback_requires_runtime_state"
fi
ORIGINAL_PREVIOUS_SHA=""
ORIGINAL_PREVIOUS_EXISTS=false
if load_optional_state_sha "$ROOT/state/previous" ORIGINAL_PREVIOUS_SHA; then
  ORIGINAL_PREVIOUS_EXISTS=true
  validate_state_release_directory "$ROOT" "$ORIGINAL_PREVIOUS_SHA"
fi
validate_state_release_directory "$ROOT" "$TARGET_SHA"
TARGET_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
TARGET_CADDY_IMAGE="${RELEASE_MANIFEST[CADDY_IMAGE]}"
TARGET_CANARY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
TARGET_PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
TARGET_API_ENV_FILE="${RELEASE_MANIFEST[API_ENV_FILE]}"
[[ "$TARGET_API_IMAGE" == *@sha256:* ]] || fail "rollback_image_not_digest_pinned"
if [[ -n "$CURRENT_API_ENV_FILE" && "$CURRENT_API_ENV_FILE" != "$TARGET_API_ENV_FILE" ]]; then
  fail "rollback_external_env_mismatch"
fi
if [[ -n "$CANDIDATE_API_ENV_FILE" && "$CANDIDATE_API_ENV_FILE" != "$TARGET_API_ENV_FILE" ]]; then
  fail "rollback_external_env_mismatch"
fi
if [[ -n "$CURRENT_SHA" ]]; then
  require_matching_host_pair \
    "$CURRENT_CANARY_HOST" "$CURRENT_PRIMARY_HOST" \
    "$TARGET_CANARY_HOST" "$TARGET_PRIMARY_HOST"
fi
if [[ -n "$CANDIDATE_SHA" ]]; then
  require_matching_host_pair \
    "$CANDIDATE_CANARY_HOST" "$CANDIDATE_PRIMARY_HOST" \
    "$TARGET_CANARY_HOST" "$TARGET_PRIMARY_HOST"
fi

if [[ "$PHASE" == "canary" ]]; then
  PRIMARY_API_IMAGE="${CURRENT_API_IMAGE:-$TARGET_API_IMAGE}"
  CANDIDATE_API_IMAGE="$TARGET_API_IMAGE"
  TARGET_SERVICES=(api-canary)
  READY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
  unset CADDY_IMAGE CADDYFILE_PATH
else
  PRIMARY_API_IMAGE="$TARGET_API_IMAGE"
  CANDIDATE_API_IMAGE="${CANDIDATE_API_IMAGE:-$TARGET_API_IMAGE}"
  CADDY_IMAGE="$TARGET_CADDY_IMAGE"
  CADDYFILE_PATH="$ROOT/releases/$TARGET_SHA/Caddyfile"
  TARGET_SERVICES=(api-primary caddy)
  READY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  export CADDY_IMAGE CADDYFILE_PATH
fi
export PRIMARY_API_IMAGE CANDIDATE_API_IMAGE
TARGET_DIR="$ROOT/releases/$TARGET_SHA"
compose=(docker compose -p brand-pilot -f "$TARGET_DIR/compose.production.yml" --env-file "$TARGET_DIR/release.env")
"${compose[@]}" config --quiet >/dev/null
"${compose[@]}" pull "${TARGET_SERVICES[@]}"
OCI_REVISION="$(docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$TARGET_API_IMAGE")"
[[ "$OCI_REVISION" == "$TARGET_SHA" ]] || fail "api_image_revision_mismatch"

state_value_or_none "$ROOT/state/current" TRANSITION_CURRENT
state_value_or_none "$ROOT/state/candidate" TRANSITION_CANDIDATE
state_value_or_none "$ROOT/state/previous" TRANSITION_PREVIOUS
prepared_state_flag "$ROOT/state/prepared" TRANSITION_PREPARED
begin_transition "$ROOT" "rollback" "$PHASE" "runtime_mutation" \
  "$TRANSITION_CURRENT" "$TRANSITION_CANDIDATE" "$TRANSITION_PREVIOUS" \
  "$TRANSITION_PREPARED" "$TARGET_SHA"

TARGET_ATTEMPTED=false
RUNTIME_STATE_COMMITTED=false
PREVIOUS_STATE_WRITTEN=false
recover_failed_rollback() {
  local exit_code="$?"
  trap - EXIT
  if [[ "$exit_code" -ne 0 ]]; then
    reconcile_transition_or_fail "$ROOT" "$READY_TIMEOUT_SECONDS"
  fi
  exit "$exit_code"
}
trap recover_failed_rollback EXIT

TARGET_ATTEMPTED=true
"${compose[@]}" up -d --no-deps --pull never "${TARGET_SERVICES[@]}"
wait_for_url "https://${READY_HOST}/ready" "$READY_TIMEOUT_SECONDS" || fail "rollback_readiness_failed"

if [[ "$PHASE" == "canary" && "$CANDIDATE_SHA" != "$TARGET_SHA" ]]; then
  atomic_write_state "$ROOT/state/candidate" "${TARGET_SHA}"$'\n'
  remove_state_file "$ROOT/state/prepared"
elif [[ "$PHASE" == "production" && "$CURRENT_SHA" != "$TARGET_SHA" ]]; then
  if [[ -n "$CURRENT_SHA" ]]; then
    atomic_write_state "$ROOT/state/previous" "${CURRENT_SHA}"$'\n'
    PREVIOUS_STATE_WRITTEN=true
  fi
  atomic_write_state "$ROOT/state/current" "${TARGET_SHA}"$'\n'
fi
RUNTIME_STATE_COMMITTED=true
if [[ "$PHASE" == "canary" ]]; then
  load_required_state_sha "$ROOT/state/candidate" COMMITTED_ROLLBACK_SHA
else
  load_required_state_sha "$ROOT/state/current" COMMITTED_ROLLBACK_SHA
fi
[[ "$COMMITTED_ROLLBACK_SHA" == "$TARGET_SHA" ]] || fail "state_commit_mismatch"
remove_state_file "$ROOT/state/transition.journal"
trap - EXIT
status_ok "rollback"
