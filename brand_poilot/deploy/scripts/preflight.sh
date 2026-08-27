#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
# shellcheck source=check-public-ports.sh
source "$SCRIPT_DIR/check-public-ports.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
SYSTEM_ROOT="${BRAND_PILOT_SYSTEM_ROOT:-}"
DOCKER_DATA_ROOT="${BRAND_PILOT_DOCKER_DATA_ROOT:-/var/lib/docker}"
MINIMUM_FREE_KIB=$((10 * 1024 * 1024))

[[ $# -eq 1 ]] || fail "usage_preflight_release_manifest"
MANIFEST="$1"
require_command flock
require_command sync
enforce_ai_content_roll_forward_floor "$ROOT"
mkdir -p -- "$ROOT/state"
if [[ "${BRAND_PILOT_PARENT_LOCK_FD:-}" == "9" && -e "/proc/$$/fd/9" ]]; then
  flock -n 9 || fail "deploy_lock_busy"
else
  exec 9>"$ROOT/state/deploy.lock"
  flock -n 9 || fail "deploy_lock_busy"
fi
reconcile_transition_or_fail "$ROOT" "${READY_TIMEOUT_SECONDS:-120}"
validate_release_manifest "$MANIFEST"
require_worker_image_manifest
require_publish_scheduler_image_manifest

require_command awk
require_command df
require_command docker
require_command dpkg
require_command grep
require_command id
require_command install
require_command mktemp
require_command mv
require_command chmod
require_command realpath
require_command sha256sum
require_command sed
require_command ss
require_command stat
require_command timedatectl
require_command timeout
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
  PUBLIC_PORT_CONTAINERS="$(docker ps \
    --filter publish=80 \
    --filter publish=443 \
    --format '{{.ID}}|{{.Names}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.Ports}}' \
    2>/dev/null || true)"
  validate_public_port_ownership "$PORT_LISTENERS" "$PUBLIC_PORT_CONTAINERS" ||
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

CODEX_RUNTIME_UID="$(id -u bpdeploy)" || fail "codex_runtime_identity_invalid"
CODEX_RUNTIME_GID="$(id -g bpdeploy)" || fail "codex_runtime_identity_invalid"
[[ "$CODEX_RUNTIME_UID" =~ ^[0-9]+$ && "$CODEX_RUNTIME_GID" =~ ^[0-9]+$ ]] ||
  fail "codex_runtime_identity_invalid"
(( CODEX_RUNTIME_UID > 0 && CODEX_RUNTIME_GID > 0 )) ||
  fail "codex_runtime_identity_invalid"
CODEX_ACCOUNT_POOL_ROOT_PATH="$ROOT/shared/codex-accounts"
[[ ! -L "$CODEX_ACCOUNT_POOL_ROOT_PATH" && -d "$CODEX_ACCOUNT_POOL_ROOT_PATH" ]] ||
  fail "codex_account_pool_missing"
[[ "$(realpath -e -- "$CODEX_ACCOUNT_POOL_ROOT_PATH")" == "$CODEX_ACCOUNT_POOL_ROOT_PATH" ]] ||
  fail "codex_account_pool_path_invalid"
[[ "$(stat -c '%a' -- "$CODEX_ACCOUNT_POOL_ROOT_PATH")" == "700" ]] ||
  fail "codex_account_pool_mode_invalid"
[[ "$(stat -c '%u:%g' -- "$CODEX_ACCOUNT_POOL_ROOT_PATH")" == "$CODEX_RUNTIME_UID:$CODEX_RUNTIME_GID" ]] ||
  fail "codex_account_pool_owner_invalid"
for profile in primary secondary; do
  profile_home="$CODEX_ACCOUNT_POOL_ROOT_PATH/$profile"
  [[ ! -L "$profile_home" && -d "$profile_home" ]] || fail "codex_profile_missing"
  [[ "$(realpath -e -- "$profile_home")" == "$profile_home" ]] || fail "codex_profile_path_invalid"
  [[ "$(stat -c '%a' -- "$profile_home")" == "700" ]] || fail "codex_profile_mode_invalid"
  [[ "$(stat -c '%u:%g' -- "$profile_home")" == "$CODEX_RUNTIME_UID:$CODEX_RUNTIME_GID" ]] ||
    fail "codex_profile_owner_invalid"
  auth_file="$profile_home/auth.json"
  [[ ! -L "$auth_file" && -f "$auth_file" ]] || fail "auth_file_missing"
  [[ "$(realpath -e -- "$auth_file")" == "$auth_file" ]] || fail "auth_file_path_invalid"
  require_file_mode_600 "$auth_file" "bpdeploy"
  [[ "$(stat -c '%g' -- "$auth_file")" == "$CODEX_RUNTIME_GID" ]] || fail "auth_file_group_invalid"
done
CODEX_HOME_PATH="$CODEX_ACCOUNT_POOL_ROOT_PATH/primary"
export CODEX_ACCOUNT_POOL_ROOT_PATH CODEX_HOME_PATH CODEX_RUNTIME_UID CODEX_RUNTIME_GID
status_ok "codex_account_pool"
status_ok "codex_auth_files"

API_ENV_FILE="$SHARED_ENV_DIR/api.env"
DM_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/dm-worker-1.env"
DM_WORKER_2_ENV_FILE="$SHARED_ENV_DIR/dm-worker-2.env"
WIKI_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/wiki-worker-1.env"
CONTENT_PROPOSAL_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/content-proposal-worker-1.env"
BRAND_INTELLIGENCE_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/brand-intelligence-worker-1.env"
SUBJECT_ANALYSIS_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/subject-analysis-worker-1.env"
IMAGE_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/image-worker-1.env"
CARD_NEWS_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/card-news-worker-1.env"
BLOG_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/blog-worker-1.env"
REEL_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/reel-worker-1.env"
PUBLISH_SCHEDULER_ENV_FILE="$SHARED_ENV_DIR/publish-scheduler.env"
[[ "${RELEASE_MANIFEST[API_ENV_FILE]}" == "$API_ENV_FILE" ]] ||
  fail "manifest_api_env_file_not_fixed"
require_file_mode_600 "$API_ENV_FILE" "bpdeploy"
require_file_mode_600 "$DM_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$DM_WORKER_2_ENV_FILE" "bpdeploy"
require_file_mode_600 "$WIKI_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$CONTENT_PROPOSAL_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$BRAND_INTELLIGENCE_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$SUBJECT_ANALYSIS_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$IMAGE_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$CARD_NEWS_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$BLOG_WORKER_1_ENV_FILE" "bpdeploy"
require_file_mode_600 "$REEL_WORKER_1_ENV_FILE" "bpdeploy"
require_publish_scheduler_environment_file "$PUBLISH_SCHEDULER_ENV_FILE"
status_ok "shared_env_files"
PUBLISH_SCHEDULER_CRON_SECRET_FILE="$(require_publish_scheduler_secret "$ROOT" "$API_ENV_FILE")"
require_file_mode_600 "$PUBLISH_SCHEDULER_CRON_SECRET_FILE" "bpdeploy"
status_ok "publish_scheduler_secret"

require_exact_boolean "LOCAL_SCHEDULER_ENABLED" "false" "$API_ENV_FILE"
require_exact_boolean "INSTAGRAM_PUBLISH_ENABLED" "true" "$API_ENV_FILE"
require_exact_boolean "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED" "true" "$API_ENV_FILE"
require_exact_boolean "AUTOMATED_CONTENT_ENABLED" "false" "$API_ENV_FILE"
case "${AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE:-false}" in
  false) require_exact_boolean "CONTENT_PROPOSALS_ENABLED" "true" "$API_ENV_FILE" ;;
  true) require_exact_boolean "CONTENT_PROPOSALS_ENABLED" "false" "$API_ENV_FILE" ;;
  *) fail "proposal_prompt_cutover_mode_invalid" ;;
esac
case "${DESIGN_STYLE_PRESET_CUTOVER_MODE:-false}" in
  false) require_exact_boolean "BRAND_CENTER_MUTATIONS_ENABLED" "true" "$API_ENV_FILE" ;;
  true) require_exact_boolean "BRAND_CENTER_MUTATIONS_ENABLED" "false" "$API_ENV_FILE" ;;
  *) fail "design_style_preset_cutover_mode_invalid" ;;
esac
require_exact_boolean "DM_WORKERS_ENABLED" "false" "$API_ENV_FILE"
for oauth_key in \
  CONTENT_SUGGESTION_OAUTH_ISSUER \
  CONTENT_SUGGESTION_OAUTH_JWKS_URI \
  CONTENT_SUGGESTION_OAUTH_RESOURCE; do
  oauth_declaration_count="$(grep -Ec "^${oauth_key}=" "$API_ENV_FILE" || true)"
  [[ "$oauth_declaration_count" == "1" ]] || fail "content_suggestion_oauth_config_invalid"
  oauth_value="$(grep -E "^${oauth_key}=" "$API_ENV_FILE" | sed 's/^[^=]*=//')"
  [[ "$oauth_value" =~ ^https://[^[:space:]#]+$ ]] || fail "content_suggestion_oauth_config_invalid"
done
oauth_audience_declaration_count="$(grep -Ec '^CONTENT_SUGGESTION_OAUTH_AUDIENCE=' "$API_ENV_FILE" || true)"
[[ "$oauth_audience_declaration_count" == "1" ]] || fail "content_suggestion_oauth_config_invalid"
oauth_subject_declaration_count="$(grep -Ec '^CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS=' "$API_ENV_FILE" || true)"
[[ "$oauth_subject_declaration_count" == "1" ]] || fail "content_suggestion_oauth_subjects_invalid"
CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS_VALUE="$(grep -E '^CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS=' "$API_ENV_FILE" | sed 's/^[^=]*=//')"
IFS=',' read -r -a oauth_subjects <<< "$CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS_VALUE"
(( ${#oauth_subjects[@]} > 0 )) || fail "content_suggestion_oauth_subjects_invalid"
declare -A oauth_seen_subjects=()
for oauth_subject in "${oauth_subjects[@]}"; do
  [[ "$oauth_subject" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] ||
    fail "content_suggestion_oauth_subjects_invalid"
  oauth_normalized_subject="${oauth_subject,,}"
  [[ -z "${oauth_seen_subjects[$oauth_normalized_subject]:-}" ]] ||
    fail "content_suggestion_oauth_subjects_invalid"
  oauth_seen_subjects[$oauth_normalized_subject]=1
done
CONTENT_SUGGESTION_OAUTH_AUDIENCE_VALUE="$(grep -E '^CONTENT_SUGGESTION_OAUTH_AUDIENCE=' "$API_ENV_FILE" | sed 's/^[^=]*=//')"
CONTENT_SUGGESTION_OAUTH_RESOURCE_VALUE="$(grep -E '^CONTENT_SUGGESTION_OAUTH_RESOURCE=' "$API_ENV_FILE" | sed 's/^[^=]*=//')"
[[ "$CONTENT_SUGGESTION_OAUTH_AUDIENCE_VALUE" == "authenticated" ]] ||
  fail "content_suggestion_oauth_audience_invalid"
[[ "$CONTENT_SUGGESTION_OAUTH_RESOURCE_VALUE" == "https://api.danbammsg.co.kr/plugins/content-suggestions/mcp" ]] ||
  fail "content_suggestion_oauth_resource_invalid"
status_ok "content_suggestion_oauth"
require_boolean "FAQ_UTTERANCE_SUGGESTIONS_ENABLED" "$API_ENV_FILE"
require_boolean "FAQ_EXPANDED_EXACT_ENABLED" "$API_ENV_FILE"
require_boolean "FAQ_MATCH_SHADOW_ENABLED" "$API_ENV_FILE"
require_boolean "FAQ_CLARIFICATION_ENABLED" "$API_ENV_FILE"
[[ "$(grep -Ec '^FAQ_MATCH_BRAND_ALLOWLIST=[^[:space:]]*$' "$API_ENV_FILE" || true)" == "1" ]] ||
  fail "faq_match_allowlist_invalid"
require_number_range "FAQ_CLARIFY_THRESHOLD" "0" "1" "$API_ENV_FILE"
require_integer_range "FAQ_CONFIRMATION_TTL_SECONDS" "30" "900" "$API_ENV_FILE"
status_ok "faq_matching_policy"
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
export DM_WORKER_IMAGE="${RELEASE_MANIFEST[DM_WORKER_IMAGE]}"
export WIKI_WORKER_IMAGE="${RELEASE_MANIFEST[WIKI_WORKER_IMAGE]}"
export CONTENT_PROPOSAL_WORKER_IMAGE="${RELEASE_MANIFEST[CONTENT_PROPOSAL_WORKER_IMAGE]}"
export BRAND_INTELLIGENCE_WORKER_IMAGE="${RELEASE_MANIFEST[BRAND_INTELLIGENCE_WORKER_IMAGE]}"
export SUBJECT_ANALYSIS_WORKER_IMAGE="${RELEASE_MANIFEST[SUBJECT_ANALYSIS_WORKER_IMAGE]}"
export IMAGE_WORKER_IMAGE="${RELEASE_MANIFEST[IMAGE_WORKER_IMAGE]}"
export CARD_NEWS_WORKER_IMAGE="${RELEASE_MANIFEST[CARD_NEWS_WORKER_IMAGE]}"
export BLOG_WORKER_IMAGE="${RELEASE_MANIFEST[BLOG_WORKER_IMAGE]}"
export REEL_WORKER_IMAGE="${RELEASE_MANIFEST[REEL_WORKER_IMAGE]}"
export PUBLISH_SCHEDULER_IMAGE="${RELEASE_MANIFEST[PUBLISH_SCHEDULER_IMAGE]}"
export PUBLISH_SCHEDULER_ENV_FILE PUBLISH_SCHEDULER_CRON_SECRET_FILE
docker compose -p brand-pilot \
  -f "$RELEASE_DIR/compose.production.yml" \
  --env-file "$MANIFEST" config --quiet >/dev/null
status_ok "compose_config"

for release_image_key in API_IMAGE "${WORKER_IMAGE_KEYS[@]}" PUBLISH_SCHEDULER_IMAGE; do
  release_image="${RELEASE_MANIFEST[$release_image_key]}"
  docker pull --quiet "$release_image" >/dev/null ||
    fail "release_image_pull_failed"
  verify_release_image_revision \
    "$release_image" \
    "$(release_image_source_revision "$release_image_key")"
done
status_ok "component_source_revision"
status_ok "release_image_revisions"

CODEX_WORKER_IMAGE_KEYS=(
  DM_WORKER_IMAGE
  CONTENT_PROPOSAL_WORKER_IMAGE
  BRAND_INTELLIGENCE_WORKER_IMAGE
  SUBJECT_ANALYSIS_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  REEL_WORKER_IMAGE
)
for codex_worker_image_key in "${CODEX_WORKER_IMAGE_KEYS[@]}"; do
  codex_worker_image="${RELEASE_MANIFEST[$codex_worker_image_key]}"
  if ! timeout --signal=TERM --kill-after=5s 30s \
    docker run --rm --pull never \
      --network none \
      --user "$CODEX_RUNTIME_UID:$CODEX_RUNTIME_GID" \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --pids-limit 64 \
      --tmpfs /tmp:size=16m,mode=1777 \
      --entrypoint /bin/sh \
      "$codex_worker_image" \
      -eu -c '
        codex_version="$(codex --version 2>/dev/null)"
        test "$codex_version" = "codex-cli 0.145.0"
        command -v bwrap >/dev/null 2>&1
      ' \
      >/dev/null 2>&1; then
    fail "codex_worker_runtime_invalid"
  fi
done
status_ok "codex_worker_runtime"

for profile in primary secondary; do
  profile_home="$CODEX_ACCOUNT_POOL_ROOT_PATH/$profile"
  if ! timeout --signal=TERM --kill-after=5s 30s \
    docker run --rm --pull never \
      --user "$CODEX_RUNTIME_UID:$CODEX_RUNTIME_GID" \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --pids-limit 128 \
      --tmpfs /tmp:size=64m,mode=1777 \
      --mount "type=bind,src=$profile_home,dst=/codex" \
      --env CODEX_HOME=/codex \
      --entrypoint /bin/sh \
      "${RELEASE_MANIFEST[BRAND_INTELLIGENCE_WORKER_IMAGE]}" \
      -eu -c 'test -w /codex && test -w /codex/auth.json && exec codex login status' \
      >/dev/null 2>&1; then
    fail "codex_login_status_failed"
  fi
done
status_ok "codex_login"

if ! timeout --signal=TERM --kill-after=5s 30s \
  docker run --rm --pull never \
    --network none \
    --user "$CODEX_RUNTIME_UID:$CODEX_RUNTIME_GID" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --security-opt apparmor=runc \
    --security-opt seccomp=unconfined \
    --security-opt systempaths=unconfined \
    --pids-limit 64 \
    --tmpfs /tmp:size=16m,mode=1777 \
    --tmpfs "/workspace:rw,size=1m,mode=0700,uid=$CODEX_RUNTIME_UID,gid=$CODEX_RUNTIME_GID" \
    --mount "type=bind,src=$CODEX_HOME_PATH,dst=/codex" \
    --env CODEX_HOME=/codex \
    --entrypoint /usr/local/bin/codex \
    "${RELEASE_MANIFEST[BRAND_INTELLIGENCE_WORKER_IMAGE]}" \
    -c 'default_permissions="worker"' \
    -c 'permissions.worker.filesystem={":minimal"="read","/codex"="deny",":workspace_roots"={"."="write"}}' \
    -c 'permissions.worker.network.enabled=false' \
    sandbox \
    --permission-profile worker \
    -C /workspace \
    -- \
    /bin/sh -eu -c '
      if /bin/sh -c ": </codex/auth.json" 2>/dev/null; then
        exit 41
      fi
      probe=/workspace/.codex-preflight-write-probe
      : > "$probe"
      rm -f -- "$probe"
    ' \
    >/dev/null 2>&1; then
  fail "codex_sandbox_policy_probe_failed"
fi
status_ok "codex_sandbox_policy"
