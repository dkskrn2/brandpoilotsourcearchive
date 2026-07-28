#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
SYSTEM_ROOT="${BRAND_PILOT_SYSTEM_ROOT:-}"
DOCKER_DATA_ROOT="${BRAND_PILOT_DOCKER_DATA_ROOT:-/var/lib/docker}"
MINIMUM_FREE_KIB=$((10 * 1024 * 1024))

[[ $# -eq 1 ]] || fail "usage_preflight_release_manifest"
MANIFEST="$1"
require_command flock
require_command sync
mkdir -p -- "$ROOT/state"
if [[ "${BRAND_PILOT_PARENT_LOCK_FD:-}" == "9" && -e "/proc/$$/fd/9" ]]; then
  flock -n 9 || fail "deploy_lock_busy"
else
  exec 9>"$ROOT/state/deploy.lock"
  flock -n 9 || fail "deploy_lock_busy"
fi
reconcile_transition_or_fail "$ROOT" "${READY_TIMEOUT_SECONDS:-120}"
validate_release_manifest "$MANIFEST"
for worker_image_key in DM_WORKER_IMAGE WIKI_WORKER_IMAGE CONTENT_PROPOSAL_WORKER_IMAGE; do
  [[ -v "RELEASE_MANIFEST[$worker_image_key]" ]] || fail "worker_image_manifest_missing"
done

require_command awk
require_command df
require_command docker
require_command dpkg
require_command grep
require_command sha256sum
require_command sed
require_command ss
require_command stat
require_command timedatectl
status_ok "commands"

OS_RELEASE="${SYSTEM_ROOT}/etc/os-release"
[[ -f "$OS_RELEASE" ]] || fail "ubuntu_release_missing"
grep -Eq '^VERSION_ID=("24\.04"|24\.04)$' "$OS_RELEASE" || fail "ubuntu_version_unsupported"
status_ok "ubuntu_version"

[[ "$(dpkg --print-architecture)" == "amd64" ]] || fail "architecture_unsupported"
status_ok "architecture"

docker info >/dev/null 2>&1 || fail "docker_unusable"
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null)" || fail "compose_unusable"
COMPOSE_VERSION="${COMPOSE_VERSION#v}"
COMPOSE_MAJOR="${COMPOSE_VERSION%%.*}"
COMPOSE_REST="${COMPOSE_VERSION#*.}"
COMPOSE_MINOR="${COMPOSE_REST%%.*}"
[[ "$COMPOSE_MAJOR" =~ ^[0-9]+$ && "$COMPOSE_MINOR" =~ ^[0-9]+$ ]] ||
  fail "compose_version_invalid"
(( COMPOSE_MAJOR > 2 || (COMPOSE_MAJOR == 2 && COMPOSE_MINOR >= 24) )) ||
  fail "compose_version_unsupported"
status_ok "docker"
status_ok "compose"

[[ "$(timedatectl show --property=NTPSynchronized --value 2>/dev/null)" == "yes" ]] ||
  fail "system_clock_unsynchronized"
status_ok "system_clock"

free_kib() {
  df -Pk -- "$1" | awk 'NR == 2 { print $4 }'
}

[[ -d "$ROOT" ]] || fail "deployment_root_missing"
[[ -d "$DOCKER_DATA_ROOT" ]] || fail "docker_data_root_missing"
ROOT_FREE_KIB="$(free_kib "$ROOT")"
DOCKER_FREE_KIB="$(free_kib "$DOCKER_DATA_ROOT")"
[[ "$ROOT_FREE_KIB" =~ ^[0-9]+$ && "$DOCKER_FREE_KIB" =~ ^[0-9]+$ ]] ||
  fail "disk_space_check_failed"
(( ROOT_FREE_KIB >= MINIMUM_FREE_KIB )) || fail "deployment_disk_space_low"
(( DOCKER_FREE_KIB >= MINIMUM_FREE_KIB )) || fail "docker_disk_space_low"
status_ok "disk_space"

PORT_LISTENERS="$(ss -H -ltnp '( sport = :80 or sport = :443 )' 2>/dev/null || true)"
if [[ -n "$PORT_LISTENERS" ]]; then
  while IFS= read -r listener; do
    [[ -z "$listener" ]] && continue
    [[ "$listener" == *"docker-proxy"* ]] || fail "public_port_owned_by_other_stack"
  done <<< "$PORT_LISTENERS"
  STACK_PORTS="$(docker ps \
    --filter label=com.docker.compose.project=brand-pilot \
    --format '{{.Ports}}' 2>/dev/null || true)"
  [[ "$STACK_PORTS" == *":80->"* && "$STACK_PORTS" == *":443->"* ]] ||
    fail "public_port_owned_by_other_stack"
fi
status_ok "public_ports"

SHARED_ENV_DIR="$ROOT/shared/env"
[[ -d "$SHARED_ENV_DIR" ]] || fail "required_env_directory_missing"
[[ "$(stat -c '%a' -- "$SHARED_ENV_DIR")" == "700" ]] ||
  fail "required_directory_mode_invalid"
[[ "$(stat -c '%U' -- "$SHARED_ENV_DIR")" == "bpdeploy" ]] ||
  fail "required_directory_owner_invalid"
status_ok "shared_env_directory"

API_ENV_FILE="$SHARED_ENV_DIR/api.env"
DM_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/dm-worker-1.env"
DM_WORKER_2_ENV_FILE="$SHARED_ENV_DIR/dm-worker-2.env"
WIKI_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/wiki-worker-1.env"
CONTENT_PROPOSAL_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/content-proposal-worker-1.env"
[[ "${RELEASE_MANIFEST[API_ENV_FILE]}" == "$API_ENV_FILE" ]] ||
  fail "manifest_api_env_file_not_fixed"
require_file_mode_600 "$API_ENV_FILE" "bpdeploy"
require_file_mode_600 "$DM_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$DM_WORKER_2_ENV_FILE" "bpdeploy"
require_file_mode_600 "$WIKI_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$CONTENT_PROPOSAL_WORKER_1_ENV_FILE" "bpdeploy"
status_ok "shared_env_files"

require_exact_false() {
  local key="$1"
  local file="$2"
  local exact_count
  local key_count
  exact_count="$(grep -Ec "^${key}=false$" "$file" || true)"
  key_count="$(grep -Ec "^${key}=" "$file" || true)"
  [[ "$exact_count" == "1" && "$key_count" == "1" ]] || fail "safe_runtime_flag_invalid"
  status_ok "$key"
}

require_exact_false "LOCAL_SCHEDULER_ENABLED" "$API_ENV_FILE"
require_exact_false "INSTAGRAM_PUBLISH_ENABLED" "$API_ENV_FILE"
require_exact_false "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED" "$API_ENV_FILE"
require_exact_false "AUTOMATED_CONTENT_ENABLED" "$API_ENV_FILE"
require_exact_false "CONTENT_PROPOSALS_ENABLED" "$API_ENV_FILE"
require_matching_env_secret \
  "CONTENT_PROPOSAL_WORKER_API_TOKEN" \
  "$API_ENV_FILE" \
  "$CONTENT_PROPOSAL_WORKER_1_ENV_FILE"
status_ok "content_proposal_worker_api_token"
require_distinct_env_secrets \
  "$API_ENV_FILE" \
  "WORKER_API_TOKEN" \
  "CONTENT_PROPOSAL_WORKER_API_TOKEN"
status_ok "content_proposal_worker_api_token_is_dedicated"

# The initial Ubuntu API/Caddy rollout is intentionally dark. Worker activation is
# a later, operator-controlled profile action after the remote lease has expired.
[[ -z "${COMPOSE_PROFILES:-}" ]] || fail "first_deploy_worker_profiles_forbidden"
# Activation evidence order:
# WIKI_ACTIVE_VERSION -> DM_WORKER_1_HEARTBEAT -> DM_WORKER_1_LEASE ->
# REMOTE_WORKER_LEASE_EXPIRED -> DM_WORKER_2.
status_ok "release_sha"
status_ok "api_image_digest"
status_ok "caddy_image_digest"

RELEASE_DIR="$(cd -- "$(dirname -- "$MANIFEST")" && pwd)"
export PRIMARY_API_IMAGE="${PRIMARY_API_IMAGE:-${RELEASE_MANIFEST[API_IMAGE]}}"
export CANDIDATE_API_IMAGE="${CANDIDATE_API_IMAGE:-${RELEASE_MANIFEST[API_IMAGE]}}"
export DM_WORKER_IMAGE="${DM_WORKER_IMAGE:-${RELEASE_MANIFEST[DM_WORKER_IMAGE]}}"
export WIKI_WORKER_IMAGE="${WIKI_WORKER_IMAGE:-${RELEASE_MANIFEST[WIKI_WORKER_IMAGE]}}"
export CONTENT_PROPOSAL_WORKER_IMAGE="${CONTENT_PROPOSAL_WORKER_IMAGE:-${RELEASE_MANIFEST[CONTENT_PROPOSAL_WORKER_IMAGE]}}"
docker compose -p brand-pilot \
  -f "$RELEASE_DIR/compose.production.yml" \
  --env-file "$MANIFEST" config --quiet >/dev/null
status_ok "compose_config"
