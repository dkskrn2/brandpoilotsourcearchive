#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
FILE_OWNER="${AI_CONTENT_PREFLIGHT_FILE_OWNER:-bpdeploy}"
AI_CONTENT_PREFLIGHT_MODE="${AI_CONTENT_PREFLIGHT_MODE:-pre-bootstrap}"
[[ $# -eq 1 ]] || fail "usage_preflight_ai_content_release_manifest"
MANIFEST="$1"
case "$AI_CONTENT_PREFLIGHT_MODE" in
  pre-bootstrap|post-bootstrap) ;;
  *) fail "ai_content_preflight_mode_invalid" ;;
esac

for command_name in docker flock grep id realpath sha256sum stat timeout; do
  require_command "$command_name"
done

if [[ "${BRAND_PILOT_PARENT_LOCK_FD:-}" == "9" && -e "/proc/$$/fd/9" ]]; then
  flock -n 9 || fail "deploy_lock_busy"
else
  mkdir -p -- "$ROOT/state"
  exec 9>"$ROOT/state/deploy.lock"
  flock -n 9 || fail "deploy_lock_busy"
fi

validate_release_manifest "$MANIFEST"
[[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "3" ]] ||
  fail "ai_content_preflight_schema_invalid"

readonly -a AI_CONTENT_IMAGE_KEYS=(
  API_IMAGE
  CONTENT_PROPOSAL_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  REEL_WORKER_IMAGE
)
for image_key in "${AI_CONTENT_IMAGE_KEYS[@]}"; do
  [[ -v "RELEASE_MANIFEST[$image_key]" ]] || fail "ai_content_preflight_image_missing"
  require_digest_image "${RELEASE_MANIFEST[$image_key]}"
done

SHARED_ENV_DIR="$ROOT/shared/env"
[[ -d "$SHARED_ENV_DIR" && ! -L "$SHARED_ENV_DIR" ]] ||
  fail "ai_content_preflight_env_directory_invalid"
[[ "$(stat -c '%a' -- "$SHARED_ENV_DIR")" == "700" ]] ||
  fail "ai_content_preflight_env_directory_mode_invalid"
[[ "$(stat -c '%U' -- "$SHARED_ENV_DIR")" == "$FILE_OWNER" ]] ||
  fail "ai_content_preflight_env_directory_owner_invalid"

API_ENV_FILE="$SHARED_ENV_DIR/api.env"
CONTENT_PROPOSAL_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/content-proposal-worker-1.env"
IMAGE_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/image-worker-1.env"
CARD_NEWS_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/card-news-worker-1.env"
BLOG_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/blog-worker-1.env"
REEL_WORKER_1_ENV_FILE="$SHARED_ENV_DIR/reel-worker-1.env"
[[ "${RELEASE_MANIFEST[API_ENV_FILE]}" == "$API_ENV_FILE" ]] ||
  fail "manifest_api_env_file_not_fixed"
for env_file in \
  "$API_ENV_FILE" \
  "$CONTENT_PROPOSAL_WORKER_1_ENV_FILE" \
  "$IMAGE_WORKER_1_ENV_FILE" \
  "$CARD_NEWS_WORKER_1_ENV_FILE" \
  "$BLOG_WORKER_1_ENV_FILE" \
  "$REEL_WORKER_1_ENV_FILE"; do
  require_file_mode_600 "$env_file" "$FILE_OWNER"
done

require_exact_boolean "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED" "true" "$API_ENV_FILE"
require_exact_boolean "AUTOMATED_CONTENT_ENABLED" "false" "$API_ENV_FILE"
require_exact_boolean "LOCAL_SCHEDULER_ENABLED" "false" "$API_ENV_FILE"
proposal_flag_count="$(grep -Ec '^CONTENT_PROPOSALS_ENABLED=(true|false)$' "$API_ENV_FILE" || true)"
proposal_key_count="$(grep -Ec '^CONTENT_PROPOSALS_ENABLED=' "$API_ENV_FILE" || true)"
[[ "$proposal_flag_count" == "1" && "$proposal_key_count" == "1" ]] ||
  fail "content_proposals_enabled_invalid"
require_matching_env_secret \
  "CONTENT_PROPOSAL_WORKER_API_TOKEN" \
  "$API_ENV_FILE" \
  "$CONTENT_PROPOSAL_WORKER_1_ENV_FILE"
for worker_env_file in \
  "$IMAGE_WORKER_1_ENV_FILE" \
  "$CARD_NEWS_WORKER_1_ENV_FILE" \
  "$BLOG_WORKER_1_ENV_FILE" \
  "$REEL_WORKER_1_ENV_FILE"; do
  require_matching_env_secret "WORKER_API_TOKEN" "$API_ENV_FILE" "$worker_env_file"
done
require_distinct_env_secrets \
  "$API_ENV_FILE" \
  "WORKER_API_TOKEN" \
  "CONTENT_PROPOSAL_WORKER_API_TOKEN"
status_ok "ai_content_env_contract"

CODEX_HOME_PATH="$ROOT/shared/codex"
[[ -d "$CODEX_HOME_PATH" && ! -L "$CODEX_HOME_PATH" ]] ||
  fail "codex_home_missing"
[[ "$(realpath -e -- "$CODEX_HOME_PATH")" == "$CODEX_HOME_PATH" ]] ||
  fail "codex_home_path_invalid"
[[ "$(stat -c '%a' -- "$CODEX_HOME_PATH")" == "700" ]] ||
  fail "codex_home_mode_invalid"
[[ "$(stat -c '%U:%G' -- "$CODEX_HOME_PATH")" == "$FILE_OWNER:$FILE_OWNER" ]] ||
  fail "codex_home_owner_invalid"
AUTH_FILE="$CODEX_HOME_PATH/auth.json"
require_file_mode_600 "$AUTH_FILE" "$FILE_OWNER"
[[ "$(stat -c '%G' -- "$AUTH_FILE")" == "$FILE_OWNER" ]] ||
  fail "auth_file_group_invalid"
CODEX_RUNTIME_UID="$(id -u "$FILE_OWNER")" || fail "codex_runtime_identity_invalid"
CODEX_RUNTIME_GID="$(id -g "$FILE_OWNER")" || fail "codex_runtime_identity_invalid"
[[ "$CODEX_RUNTIME_UID" =~ ^[0-9]+$ && "$CODEX_RUNTIME_GID" =~ ^[0-9]+$ ]] ||
  fail "codex_runtime_identity_invalid"
(( CODEX_RUNTIME_UID > 0 && CODEX_RUNTIME_GID > 0 )) ||
  fail "codex_runtime_identity_invalid"
[[ "$(stat -c '%u:%g' -- "$CODEX_HOME_PATH")" == "$CODEX_RUNTIME_UID:$CODEX_RUNTIME_GID" ]] ||
  fail "codex_runtime_identity_mismatch"
export CODEX_HOME_PATH CODEX_RUNTIME_UID CODEX_RUNTIME_GID
status_ok "ai_content_codex_auth"

RELEASE_DIR="$(cd -- "$(dirname -- "$MANIFEST")" && pwd)"
export PRIMARY_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
export CANDIDATE_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
export CONTENT_PROPOSAL_WORKER_IMAGE="${RELEASE_MANIFEST[CONTENT_PROPOSAL_WORKER_IMAGE]}"
export IMAGE_WORKER_IMAGE="${RELEASE_MANIFEST[IMAGE_WORKER_IMAGE]}"
export CARD_NEWS_WORKER_IMAGE="${RELEASE_MANIFEST[CARD_NEWS_WORKER_IMAGE]}"
export BLOG_WORKER_IMAGE="${RELEASE_MANIFEST[BLOG_WORKER_IMAGE]}"
export REEL_WORKER_IMAGE="${RELEASE_MANIFEST[REEL_WORKER_IMAGE]}"
COMPOSE_PROFILES="content-proposal-worker-1,image-worker-1,card-news-worker-1,blog-worker-1,reel-worker-1" \
  docker compose -p brand-pilot \
    -f "$RELEASE_DIR/compose.production.yml" \
    --env-file "$MANIFEST" config --quiet >/dev/null ||
  fail "ai_content_compose_config_invalid"
status_ok "ai_content_compose_config"

for image_key in "${AI_CONTENT_IMAGE_KEYS[@]}"; do
  image="${RELEASE_MANIFEST[$image_key]}"
  docker pull --quiet "$image" >/dev/null || fail "ai_content_release_image_pull_failed"
  verify_release_image_revision "$image" "$(release_image_source_revision "$image_key")"
  [[ "$(docker image inspect --format '{{.Config.User}}' "$image")" == "node" ]] ||
    fail "ai_content_release_image_user_invalid"
done
status_ok "ai_content_release_images"

readonly -a AI_CONTENT_CODEX_IMAGE_KEYS=(
  CONTENT_PROPOSAL_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  REEL_WORKER_IMAGE
)
for image_key in "${AI_CONTENT_CODEX_IMAGE_KEYS[@]}"; do
  image="${RELEASE_MANIFEST[$image_key]}"
  timeout --signal=TERM --kill-after=5s 30s \
    docker run --rm --pull never \
      --network none \
      --user "$CODEX_RUNTIME_UID:$CODEX_RUNTIME_GID" \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --pids-limit 64 \
      --tmpfs /tmp:size=16m,mode=1777 \
      --entrypoint /bin/sh \
      "$image" \
      -eu -c 'test "$(codex --version 2>/dev/null)" = "codex-cli 0.145.0"; command -v bwrap >/dev/null 2>&1' \
      >/dev/null 2>&1 || fail "ai_content_codex_runtime_invalid"
done

timeout --signal=TERM --kill-after=5s 30s \
  docker run --rm --pull never \
    --network none \
    --user "$CODEX_RUNTIME_UID:$CODEX_RUNTIME_GID" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --tmpfs /tmp:size=16m,mode=1777 \
    --mount "type=bind,src=$CODEX_HOME_PATH,dst=/codex" \
    --env CODEX_HOME=/codex \
    --entrypoint /usr/local/bin/codex \
    "${RELEASE_MANIFEST[CONTENT_PROPOSAL_WORKER_IMAGE]}" login status \
    >/dev/null 2>&1 || fail "ai_content_codex_login_invalid"
status_ok "ai_content_codex_runtime"

if [[ "$AI_CONTENT_PREFLIGHT_MODE" == "post-bootstrap" ]]; then
  APPLICATION_DATABASE_URL_FILE="$ROOT/shared/secrets/ai-content-application-database-url"
  require_file_mode_600 "$APPLICATION_DATABASE_URL_FILE" "$FILE_OWNER"
  application_database_url="$(<"$APPLICATION_DATABASE_URL_FILE")"
  [[ "$application_database_url" =~ ^postgres(ql)?://[^[:space:]]+$ ]] ||
    fail "ai_content_application_database_url_invalid"
  timeout --signal=TERM --kill-after=5s 30s \
    docker run --rm --pull never \
      --network none \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --pids-limit 64 \
      --tmpfs /tmp:size=16m,mode=1777 \
      --mount "type=bind,src=$APPLICATION_DATABASE_URL_FILE,dst=/run/secrets/ai_content_application_database_url,readonly" \
      --entrypoint node \
      "${RELEASE_MANIFEST[API_IMAGE]}" \
      /app/scripts/ai-content-cutover-control.mjs \
      --validate-database-url-file \
      --database-url-file /run/secrets/ai_content_application_database_url \
      >/dev/null 2>&1 || fail "ai_content_application_database_secret_runtime_invalid"
  status_ok "ai_content_application_database_secret"
fi

status_ok "ai_content_preflight"
