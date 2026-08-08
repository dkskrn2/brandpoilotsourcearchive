#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
FILE_OWNER="${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
MODE="${1:-}"
[[ "$MODE" == "--stop-legacy" || "$MODE" == "--roll-forward" ]] ||
  fail "ai_content_runtime_cutover_mode_invalid"
shift

declare -A OPTION=()
while [[ $# -gt 0 ]]; do
  [[ "$1" == --* && $# -ge 2 ]] || fail "ai_content_runtime_cutover_arguments_invalid"
  option_key="${1#--}"
  [[ "$option_key" =~ ^[a-z0-9-]+$ && ! -v "OPTION[$option_key]" ]] ||
    fail "ai_content_runtime_cutover_arguments_invalid"
  OPTION["$option_key"]="$2"
  shift 2
done

option() {
  local key="$1"
  [[ -v "OPTION[$key]" && -n "${OPTION[$key]}" ]] ||
    fail "ai_content_runtime_cutover_argument_missing"
  printf '%s' "${OPTION[$key]}"
}

require_uuid() {
  [[ "$1" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] ||
    fail "ai_content_runtime_cutover_id_invalid"
}

require_secure_input() {
  [[ "$1" =~ ^/[a-zA-Z0-9._/-]+$ ]] || fail "ai_content_runtime_input_path_invalid"
  require_file_mode_600 "$1" "$FILE_OWNER"
}

for command_name in docker flock grep id mkdir; do
  require_command "$command_name"
done

RELEASE_SHA="$(option release)"
CUTOVER_ID="$(option cutover-id)"
OPERATOR_URL_FILE="$(option operator-url-file)"
require_release_sha "$RELEASE_SHA"
require_uuid "$CUTOVER_ID"
require_secure_input "$OPERATOR_URL_FILE"

[[ "${#OPTION[@]}" -eq 3 || "$MODE" == "--stop-legacy" ]] ||
  fail "ai_content_runtime_cutover_arguments_invalid"
if [[ "$MODE" == "--stop-legacy" ]]; then
  [[ "${#OPTION[@]}" -eq 4 ]] || fail "ai_content_runtime_cutover_arguments_invalid"
  APPLICATION_URL_FILE="$(option application-url-file)"
  require_secure_input "$APPLICATION_URL_FILE"
fi

mkdir -p -- "$ROOT/state"
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"

CURRENT_SHA=""
ACTIVE_CUTOVER_ID=""
load_required_state_sha "$ROOT/state/current" CURRENT_SHA
[[ "$CURRENT_SHA" == "$RELEASE_SHA" ]] || fail "ai_content_runtime_current_release_mismatch"
require_secure_state_file "$ROOT/state/ai-content-cutover-id"
ACTIVE_CUTOVER_ID="$(<"$ROOT/state/ai-content-cutover-id")"
[[ "$ACTIVE_CUTOVER_ID" == "$CUTOVER_ID" ]] || fail "ai_content_runtime_active_cutover_mismatch"

RELEASE_DIR="$ROOT/releases/$RELEASE_SHA"
validate_release_directory "$RELEASE_DIR"
[[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "3" ]] ||
  fail "ai_content_runtime_release_schema_invalid"
require_worker_image_manifest

readonly -a POST_SERVICES=(
  content-proposal-worker-1
  image-worker-1
  card-news-worker-1
  blog-worker-1
  reel-worker-1
)
readonly -a POST_IMAGE_KEYS=(
  CONTENT_PROPOSAL_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  REEL_WORKER_IMAGE
)
readonly -a PRE_SERVICES=(
  content-proposal-worker-1
  image-worker-1
  card-news-worker-1
  blog-worker-1
  marketing-worker-1
)
readonly -a PRE_IMAGE_KEYS=(
  CONTENT_PROPOSAL_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  MARKETING_WORKER_IMAGE
)

expected_status() {
  local phase="$1"
  if [[ "$phase" == "pre" ]]; then
    printf '%s' "{\"activeCutoverCount\":1,\"activeCutoverId\":\"$CUTOVER_ID\",\"cleanupCredentialRevokedAt\":null,\"cleanupRevocationEvidenceSha256\":null,\"cutoverId\":\"$CUTOVER_ID\",\"maintenanceCutoverId\":\"$CUTOVER_ID\",\"maintenanceEnabled\":true,\"markerPresent\":false,\"status\":\"maintenance_verified\"}"
  else
    printf '%s' "{\"activeCutoverCount\":1,\"activeCutoverId\":\"$CUTOVER_ID\",\"cleanupCredentialRevokedAt\":null,\"cleanupRevocationEvidenceSha256\":null,\"cutoverId\":\"$CUTOVER_ID\",\"maintenanceCutoverId\":\"$CUTOVER_ID\",\"maintenanceEnabled\":true,\"markerPresent\":true,\"status\":\"migration_body_complete\"}"
  fi
}

verify_status() {
  local phase="$1"
  local observed expected
  expected="$(expected_status "$phase")"
  observed="$("$SCRIPT_DIR/verify-ai-content-cutover.sh" --status \
    --operator-url-file "$OPERATOR_URL_FILE" --cutover-id "$CUTOVER_ID")" ||
    fail "ai_content_runtime_cutover_status_invalid"
  [[ "$observed" == "$expected" ]] || fail "ai_content_runtime_cutover_status_invalid"
}

STATE_DIRECTORY="$ROOT/state/ai-content-cutovers/$CUTOVER_ID/runtime-rollout"
mkdir -p -- "$ROOT/state/ai-content-cutovers" \
  "$ROOT/state/ai-content-cutovers/$CUTOVER_ID" "$STATE_DIRECTORY"

write_or_verify_evidence() {
  local output_file="$1"
  local body="$2"
  if [[ -e "$output_file" || -L "$output_file" ]]; then
    require_file_mode_600 "$output_file" "$FILE_OWNER"
    [[ "$(<"$output_file")" == "$body" ]] || fail "ai_content_runtime_evidence_mismatch"
  else
    atomic_write "$output_file" "${body}"$'\n' 600
    require_file_mode_600 "$output_file" "$FILE_OWNER"
  fi
}

declare -a CANDIDATE_PROFILE_ARGS=()
for service in "${POST_SERVICES[@]}"; do
  CANDIDATE_PROFILE_ARGS+=(--profile "$service")
done
candidate_compose=(docker compose -p brand-pilot -f "$RELEASE_DIR/compose.production.yml" \
  --env-file "$RELEASE_DIR/release.env" "${CANDIDATE_PROFILE_ARGS[@]}")

verify_candidate_service() {
  local index="$1"
  local service="${POST_SERVICES[$index]}"
  local image_key="${POST_IMAGE_KEYS[$index]}"
  local container_id running_image
  container_id="$("${candidate_compose[@]}" ps --status running -q "$service")"
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] || fail "ai_content_runtime_candidate_not_running"
  running_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")" ||
    fail "ai_content_runtime_candidate_inspect_failed"
  [[ "$running_image" == "${RELEASE_MANIFEST[$image_key]}" ]] ||
    fail "ai_content_runtime_candidate_image_mismatch"
}

if [[ "$MODE" == "--stop-legacy" ]]; then
  verify_status pre
  PREVIOUS_SHA=""
  load_required_state_sha "$ROOT/state/previous" PREVIOUS_SHA
  [[ "$PREVIOUS_SHA" != "$RELEASE_SHA" ]] || fail "ai_content_runtime_previous_release_invalid"
  PREVIOUS_DIR="$ROOT/releases/$PREVIOUS_SHA"
  validate_legacy_marketing_cutover_source "$PREVIOUS_DIR"

  declare -a LEGACY_PROFILE_ARGS=()
  for service in "${PRE_SERVICES[@]}"; do
    LEGACY_PROFILE_ARGS+=(--profile "$service")
  done
  legacy_compose=(docker compose -p brand-pilot -f "$PREVIOUS_DIR/compose.production.yml" \
    --env-file "$PREVIOUS_DIR/release.env" "${LEGACY_PROFILE_ARGS[@]}")
  "${legacy_compose[@]}" config --quiet >/dev/null || fail "ai_content_runtime_legacy_compose_invalid"

  for index in "${!PRE_SERVICES[@]}"; do
    service="${PRE_SERVICES[$index]}"
    image_key="${PRE_IMAGE_KEYS[$index]}"
    expected_image="$(legacy_release_manifest_value "$PREVIOUS_DIR/release.env" "$image_key")"
    require_digest_image "$expected_image"
    container_id="$("${legacy_compose[@]}" ps -a -q "$service")"
    [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] || fail "ai_content_runtime_legacy_container_invalid"
    running_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")" ||
      fail "ai_content_runtime_legacy_inspect_failed"
    [[ "$running_image" == "$expected_image" ]] || fail "ai_content_runtime_legacy_image_mismatch"
  done

  lease_count="$(docker run --rm --pull never --read-only --user "$(id -u):$(id -g)" \
    --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m --entrypoint node \
    --env-file "$ROOT/shared/env/api.env" \
    --mount "type=bind,src=$APPLICATION_URL_FILE,dst=/run/secrets/application-database-url,readonly" \
    "${RELEASE_MANIFEST[API_IMAGE]}" /app/scripts/ai-content-cutover-control.mjs \
    --count-active-content-leases --database-url-file /run/secrets/application-database-url)" ||
    fail "ai_content_runtime_processing_lease_probe_failed"
  [[ "$lease_count" =~ ^[0-9]+$ ]] || fail "ai_content_runtime_processing_lease_probe_failed"
  [[ "$lease_count" == "0" ]] || fail "ai_content_runtime_processing_lease_active"

  "${legacy_compose[@]}" stop --timeout 30 "${PRE_SERVICES[@]}" >/dev/null ||
    fail "ai_content_runtime_legacy_stop_failed"
  for service in "${PRE_SERVICES[@]}"; do
    [[ -z "$("${legacy_compose[@]}" ps --status running -q "$service")" ]] ||
      fail "ai_content_runtime_legacy_stop_unverified"
  done
  verify_status pre
  pre_body="{\"contractVersion\":\"ai-content-runtime-rollout-evidence.v1\",\"cutoverId\":\"$CUTOVER_ID\",\"releaseSha\":\"$RELEASE_SHA\",\"services\":[\"content-proposal-worker-1\",\"image-worker-1\",\"card-news-worker-1\",\"blog-worker-1\",\"marketing-worker-1\"],\"status\":\"maintenance_verified\"}"
  write_or_verify_evidence "$STATE_DIRECTORY/pre-marker-stop.json" "$pre_body"
  status_ok "ai_content_runtime_legacy_stop"
  exit 0
fi

verify_status post
post_evidence="$STATE_DIRECTORY/post-marker-roll-forward.json"
if [[ ! -e "$post_evidence" && ! -L "$post_evidence" ]]; then
  for index in "${!POST_IMAGE_KEYS[@]}"; do
    image_key="${POST_IMAGE_KEYS[$index]}"
    image="${RELEASE_MANIFEST[$image_key]}"
    require_digest_image "$image"
    docker pull --quiet "$image" >/dev/null || fail "ai_content_runtime_candidate_pull_failed"
    verify_release_image_revision "$image" "$(release_image_source_revision "$image_key")"
  done
  "${candidate_compose[@]}" config --quiet >/dev/null || fail "ai_content_runtime_candidate_compose_invalid"

  PREVIOUS_SHA="${MARKETING_RETIREMENT_SOURCE_RELEASE_SHA}"
  PREVIOUS_DIR="$ROOT/releases/$PREVIOUS_SHA"
  validate_legacy_marketing_cutover_source "$PREVIOUS_DIR"
  marketing_compose=(docker compose -p brand-pilot -f "$PREVIOUS_DIR/compose.production.yml" \
    --env-file "$PREVIOUS_DIR/release.env" --profile marketing-worker-1)
  "${marketing_compose[@]}" config --quiet >/dev/null || fail "ai_content_runtime_legacy_compose_invalid"
  marketing_id="$("${marketing_compose[@]}" ps -a -q marketing-worker-1)"
  if [[ -n "$marketing_id" ]]; then
    [[ "$marketing_id" =~ ^[0-9a-f]{12,64}$ ]] || fail "ai_content_runtime_legacy_container_invalid"
    expected_marketing_image="$(legacy_release_manifest_value "$PREVIOUS_DIR/release.env" MARKETING_WORKER_IMAGE)"
    require_digest_image "$expected_marketing_image"
    [[ "$(docker inspect --format '{{.Config.Image}}' "$marketing_id")" == "$expected_marketing_image" ]] ||
      fail "ai_content_runtime_legacy_image_mismatch"
    "${marketing_compose[@]}" stop --timeout 30 marketing-worker-1 >/dev/null ||
      fail "ai_content_runtime_marketing_stop_failed"
    "${marketing_compose[@]}" rm -f marketing-worker-1 >/dev/null ||
      fail "ai_content_runtime_marketing_remove_failed"
  fi

  "${candidate_compose[@]}" up -d --no-deps --pull never --force-recreate "${POST_SERVICES[@]}" ||
    fail "ai_content_runtime_candidate_start_failed"
fi

for index in "${!POST_SERVICES[@]}"; do
  verify_candidate_service "$index"
done
verify_status post
post_body="{\"contractVersion\":\"ai-content-runtime-rollout-evidence.v1\",\"cutoverId\":\"$CUTOVER_ID\",\"releaseSha\":\"$RELEASE_SHA\",\"services\":[\"content-proposal-worker-1\",\"image-worker-1\",\"card-news-worker-1\",\"blog-worker-1\",\"reel-worker-1\"],\"status\":\"migration_body_complete\"}"
write_or_verify_evidence "$post_evidence" "$post_body"
status_ok "ai_content_runtime_roll_forward"
