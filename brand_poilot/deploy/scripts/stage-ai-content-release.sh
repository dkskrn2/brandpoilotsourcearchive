#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SOURCE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
[[ $# -eq 1 ]] || fail "usage_stage_ai_content_release_manifest"
MANIFEST="$1"

for command_name in cmp flock install mktemp sha256sum sync; do
  require_command "$command_name"
done

enforce_ai_content_staging_floor() {
  local marker_status
  enforce_ai_content_roll_forward_floor "$1"
  if ai_content_cutover_marker_present "$1"; then
    fail "ai_content_staging_post_marker_forbidden"
  else
    marker_status="$?"
  fi
  [[ "$marker_status" -eq 1 ]] || fail "ai_content_cutover_floor_query_failed"
}

enforce_ai_content_staging_floor "$ROOT"
mkdir -p -- "$ROOT/releases" "$ROOT/state"
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"
enforce_ai_content_staging_floor "$ROOT"

validate_release_manifest "$MANIFEST"
require_worker_image_manifest
[[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "3" ]] ||
  fail "ai_content_staged_release_schema_invalid"
RELEASE_SHA="${RELEASE_MANIFEST[RELEASE_SHA]}"
require_release_sha "$RELEASE_SHA"
RELEASE_DIR="$ROOT/releases/$RELEASE_SHA"
STAGED_POINTER="$ROOT/state/ai-content-staged-release"

EXISTING_STAGED_SHA=""
if load_optional_state_sha "$STAGED_POINTER" EXISTING_STAGED_SHA; then
  [[ "$EXISTING_STAGED_SHA" == "$RELEASE_SHA" ]] ||
    fail "ai_content_staged_release_conflict"
  validate_release_directory "$RELEASE_DIR"
  cmp -s -- "$MANIFEST" "$RELEASE_DIR/release.env" ||
    fail "immutable_release_manifest_mismatch"
  status_ok "ai_content_release_already_staged"
  exit 0
fi

if [[ -e "$RELEASE_DIR" || -L "$RELEASE_DIR" ]]; then
  validate_release_directory "$RELEASE_DIR"
  cmp -s -- "$MANIFEST" "$RELEASE_DIR/release.env" ||
    fail "immutable_release_manifest_mismatch"
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
  if [[ -v "RELEASE_MANIFEST[MARKETING_RETIREMENT_SHA256]" ]]; then
    retirement_source="$(cd -- "$(dirname -- "$MANIFEST")" && pwd)/marketing-worker-retirement.json"
    install -m 0400 "$retirement_source" "$STAGING_DIR/marketing-worker-retirement.json"
  fi
  generate_release_integrity "$STAGING_DIR"
  mv -- "$STAGING_DIR" "$RELEASE_DIR"
  trap - EXIT
fi

validate_release_directory "$RELEASE_DIR"
PREFLIGHT="${PREFLIGHT_SCRIPT:-$RELEASE_DIR/scripts/preflight-ai-content.sh}"
[[ -f "$PREFLIGHT" && ! -L "$PREFLIGHT" && -x "$PREFLIGHT" ]] ||
  fail "ai_content_preflight_script_invalid"
AI_CONTENT_PREFLIGHT_MODE="${AI_CONTENT_PREFLIGHT_MODE:-pre-bootstrap}" \
  BRAND_PILOT_PARENT_LOCK_FD=9 "$PREFLIGHT" "$RELEASE_DIR/release.env"

atomic_write_state "$STAGED_POINTER" "${RELEASE_SHA}"$'\n'
load_required_state_sha "$STAGED_POINTER" COMMITTED_STAGED_SHA
[[ "$COMMITTED_STAGED_SHA" == "$RELEASE_SHA" ]] ||
  fail "ai_content_staged_release_commit_mismatch"
status_ok "ai_content_release_staged"
