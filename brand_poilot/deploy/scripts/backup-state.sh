#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
PROVIDER_BACKUP_ID=""
CADDY_BACKUP_ID=""
CADDY_DATA_SHA256=""
OUTPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider-backup-id) PROVIDER_BACKUP_ID="${2:-}"; shift 2 ;;
    --caddy-backup-id) CADDY_BACKUP_ID="${2:-}"; shift 2 ;;
    --caddy-data-sha256) CADDY_DATA_SHA256="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    *) fail "usage_backup_state_metadata" ;;
  esac
done

[[ "$PROVIDER_BACKUP_ID" =~ ^[A-Za-z0-9._:/-]{6,200}$ ]] || fail "provider_backup_id_invalid"
[[ "$CADDY_BACKUP_ID" =~ ^[A-Za-z0-9._:/-]{6,200}$ ]] || fail "caddy_backup_id_invalid"
[[ "$CADDY_DATA_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail "caddy_data_checksum_invalid"
[[ "$OUTPUT" == "$ROOT/state/backups/"*.env ]] || fail "backup_metadata_output_invalid"

for command_name in awk flock sha256sum sync; do
  require_command "$command_name"
done
mkdir -p -- "$ROOT/state/backups"
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"
reconcile_transition_or_fail "$ROOT" "${READY_TIMEOUT_SECONDS:-120}"

load_required_state_sha "$ROOT/state/candidate" CANDIDATE_RELEASE_SHA
validate_release_directory "$ROOT/releases/$CANDIDATE_RELEASE_SHA"
CANDIDATE_MANIFEST_SHA256="$(sha256sum -- "$ROOT/releases/$CANDIDATE_RELEASE_SHA/release.env" | awk '{print $1}')"
EXTERNAL_ENV_FILE="${RELEASE_MANIFEST[API_ENV_FILE]}"
require_file_mode_600 "$EXTERNAL_ENV_FILE"
EXTERNAL_ENV_SHA256="$(sha256sum -- "$EXTERNAL_ENV_FILE" | awk '{print $1}')"

CURRENT_RELEASE_SHA="NONE"
CURRENT_IMAGE_DIGEST="NONE"
if load_optional_state_sha "$ROOT/state/current" CURRENT_RELEASE_SHA; then
  validate_release_directory "$ROOT/releases/$CURRENT_RELEASE_SHA"
  CURRENT_IMAGE_DIGEST="${RELEASE_MANIFEST[API_IMAGE]}"
fi

printf -v metadata \
  'BACKUP_SCHEMA=1\nPROVIDER_BACKUP_ID=%s\nCADDY_BACKUP_ID=%s\nCADDY_DATA_SHA256=%s\nCURRENT_RELEASE_SHA=%s\nCURRENT_IMAGE_DIGEST=%s\nCANDIDATE_RELEASE_SHA=%s\nRELEASE_MANIFEST_SHA256=%s\nEXTERNAL_ENV_SHA256=%s\n' \
  "$PROVIDER_BACKUP_ID" "$CADDY_BACKUP_ID" "$CADDY_DATA_SHA256" \
  "$CURRENT_RELEASE_SHA" "$CURRENT_IMAGE_DIGEST" "$CANDIDATE_RELEASE_SHA" \
  "$CANDIDATE_MANIFEST_SHA256" "$EXTERNAL_ENV_SHA256"
atomic_write_state "$OUTPUT" "$metadata"
status_ok "backup_metadata"
