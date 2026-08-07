#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

MODE="${1:-}"
[[ "$MODE" == "--status" || "$MODE" == "--assert-rollback-allowed" ]] ||
  fail "ai_content_cutover_verify_mode_invalid"
shift
declare -A OPTION=()
while [[ $# -gt 0 ]]; do
  [[ "$1" == --* && $# -ge 2 ]] || fail "ai_content_cutover_verify_arguments_invalid"
  key="${1#--}"
  [[ "$key" =~ ^[a-z0-9-]+$ && ! -v "OPTION[$key]" ]] || fail "ai_content_cutover_verify_arguments_invalid"
  OPTION["$key"]="$2"
  shift 2
done
for key in operator-url-file cutover-id; do
  [[ -v "OPTION[$key]" && -n "${OPTION[$key]}" ]] || fail "ai_content_cutover_verify_argument_missing"
done

DATABASE_FILE="${OPTION[operator-url-file]}"
CUTOVER_ID="${OPTION[cutover-id]}"
FILE_OWNER="${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
[[ "$CUTOVER_ID" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] ||
  fail "ai_content_cutover_id_invalid"
[[ "$DATABASE_FILE" =~ ^/[a-zA-Z0-9._/-]+$ ]] || fail "ai_content_cutover_input_path_invalid"
require_file_mode_600 "$DATABASE_FILE" "$FILE_OWNER"

RELEASE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
validate_release_directory "$RELEASE_DIR"
API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
verify_release_image_revision "$API_IMAGE" "$(release_image_source_revision API_IMAGE)"
[[ "$(docker image inspect --format '{{.Config.User}}' "$API_IMAGE")" == "node" ]] ||
  fail "ai_content_cutover_api_image_user_invalid"
require_file_mode_600 "${RELEASE_MANIFEST[API_ENV_FILE]}"

OUTPUT="$(docker run --rm --read-only --user "$(id -u):$(id -g)" \
  --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m --entrypoint node \
  --env-file "${RELEASE_MANIFEST[API_ENV_FILE]}" \
  --mount "type=bind,src=$DATABASE_FILE,dst=/run/secrets/operator-database-url,readonly" \
  "$API_IMAGE" /app/scripts/ai-content-cutover-control.mjs "$MODE" \
  --database-url-file /run/secrets/operator-database-url --cutover-id "$CUTOVER_ID")" ||
  fail "ai_content_cutover_verify_failed"
grep -q "\"cutoverId\":\"$CUTOVER_ID\"" <<<"$OUTPUT" || fail "ai_content_cutover_verify_evidence_invalid"
printf '%s\n' "$OUTPUT"
