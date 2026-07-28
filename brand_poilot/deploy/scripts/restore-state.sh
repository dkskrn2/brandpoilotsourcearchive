#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
TEST_DATABASE_URL_FILE=""
BACKUP_METADATA=""
EXPECTED_SCHEMA_VERSION=""
ROW_COUNT_MANIFEST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --test-database-url-file) TEST_DATABASE_URL_FILE="${2:-}"; shift 2 ;;
    --backup-metadata) BACKUP_METADATA="${2:-}"; shift 2 ;;
    --expected-schema-version) EXPECTED_SCHEMA_VERSION="${2:-}"; shift 2 ;;
    --row-count-manifest) ROW_COUNT_MANIFEST="${2:-}"; shift 2 ;;
    *) fail "usage_restore_state_test_database" ;;
  esac
done

[[ "${RESTORE_REHEARSAL_TEST_ONLY:-}" == "I_UNDERSTAND_TEST_DATABASE_ONLY" ]] ||
  fail "restore_rehearsal_test_only_confirmation_required"
require_file_mode_600 "$TEST_DATABASE_URL_FILE"
require_secure_state_file "$BACKUP_METADATA"
require_file_mode_600 "$ROW_COUNT_MANIFEST"
[[ "$EXPECTED_SCHEMA_VERSION" =~ ^[0-9]{3}_[A-Za-z0-9_.-]+\.sql$ ]] ||
  fail "expected_schema_version_invalid"
[[ -x "${RESTORE_REHEARSAL_COMMAND:-}" && ! -L "${RESTORE_REHEARSAL_COMMAND:-}" ]] ||
  fail "restore_rehearsal_command_invalid"

for command_name in flock psql; do
  require_command "$command_name"
done
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"

TEST_DATABASE_URL="$(<"$TEST_DATABASE_URL_FILE")"
[[ "$TEST_DATABASE_URL" =~ ^postgres(ql)?://[^[:space:]]+/[A-Za-z0-9_-]*_restore_test(\?.*)?$ ]] ||
  fail "restore_target_database_must_be_test_only"

provider_backup_id="$(awk -F= '$1 == "PROVIDER_BACKUP_ID" { print substr($0, index($0, "=") + 1) }' "$BACKUP_METADATA")"
[[ "$provider_backup_id" =~ ^[A-Za-z0-9._:/-]{6,200}$ ]] || fail "provider_backup_id_invalid"
"$RESTORE_REHEARSAL_COMMAND" \
  --provider-backup-id "$provider_backup_id" \
  --target-database-url-file "$TEST_DATABASE_URL_FILE"

actual_schema_version="$(psql "$TEST_DATABASE_URL" -XAtq \
  -c "select id from schema_migrations order by id desc limit 1")"
[[ "$actual_schema_version" == "$EXPECTED_SCHEMA_VERSION" ]] || fail "schema_version_mismatch"

while IFS='=' read -r relation expected_count || [[ -n "$relation$expected_count" ]]; do
  [[ -z "$relation$expected_count" ]] && continue
  [[ "$relation" =~ ^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$ ]] ||
    fail "row_count_manifest_invalid"
  [[ "$expected_count" =~ ^[0-9]+$ ]] || fail "row_count_manifest_invalid"
  actual_count="$(psql "$TEST_DATABASE_URL" -XAtq -c "select count(*) from $relation")"
  [[ "$actual_count" == "$expected_count" ]] || fail "row_count_mismatch"
done < "$ROW_COUNT_MANIFEST"

status_ok "restore_rehearsal"
