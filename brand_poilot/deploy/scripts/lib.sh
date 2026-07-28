#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  local code="${1:-deployment_failed}"
  printf 'error=%s\n' "$code" >&2
  exit 1
}

status_ok() {
  printf '%s=ok\n' "$1"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required_command_missing"
}

require_file_mode_600() {
  local file="$1"
  local expected_owner="${2:-}"
  [[ -f "$file" ]] || fail "required_file_missing"
  [[ "$(stat -c '%a' -- "$file")" == "600" ]] || fail "required_file_mode_invalid"
  if [[ -n "$expected_owner" ]]; then
    [[ "$(stat -c '%U' -- "$file")" == "$expected_owner" ]] || fail "required_file_owner_invalid"
  fi
}

env_secret_value_digest() {
  local key="$1"
  local file="$2"
  local declaration_count
  local canonical_count

  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail "shared_secret_key_invalid"
  declaration_count="$(
    grep -Ec "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*([=:]|$)" "$file" ||
      true
  )"
  [[ "$declaration_count" =~ ^[0-9]+$ ]] || fail "shared_secret_invalid"
  [[ "$declaration_count" != "0" ]] || fail "shared_secret_missing"
  [[ "$declaration_count" == "1" ]] || fail "shared_secret_invalid"
  grep -Eq "^${key}=required-at-deploy-time$" "$file" &&
    fail "shared_secret_missing"
  canonical_count="$(grep -Ec "^${key}=[A-Za-z0-9+/=_:.@%-]+$" "$file" || true)"
  [[ "$canonical_count" == "1" ]] || fail "shared_secret_invalid"

  grep -E "^${key}=" "$file" |
    sed 's/^[^=]*=//' |
    sha256sum |
    awk '{print $1}'
}

require_matching_env_secret() {
  local key="$1"
  local left_file="$2"
  local right_file="$3"
  local left_digest
  local right_digest

  left_digest="$(env_secret_value_digest "$key" "$left_file")"
  right_digest="$(env_secret_value_digest "$key" "$right_file")"
  [[ "$left_digest" == "$right_digest" ]] || fail "shared_secret_mismatch"
}

require_distinct_env_secrets() {
  local file="$1"
  local first_key="$2"
  local second_key="$3"
  local first_digest
  local second_digest

  first_digest="$(env_secret_value_digest "$first_key" "$file")"
  second_digest="$(env_secret_value_digest "$second_key" "$file")"
  [[ "$first_digest" != "$second_digest" ]] || fail "shared_secret_reuse"
}

require_digest_image() {
  local value="$1"
  [[ "$value" =~ ^[a-zA-Z0-9._-]+(:[0-9]+)?(/[a-zA-Z0-9._-]+)+@sha256:[a-f0-9]{64}$ ]] ||
    fail "image_must_be_digest_pinned"
}

require_release_sha() {
  [[ "$1" =~ ^[a-f0-9]{40}$ ]] || fail "release_sha_invalid"
}

require_hostname() {
  local value="$1"
  [[ "$value" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] ||
    fail "manifest_host_invalid"
}

require_matching_host_pair() {
  local left_canary_host="$1"
  local left_primary_host="$2"
  local right_canary_host="$3"
  local right_primary_host="$4"
  local error_code="${5:-release_hosts_mismatch}"
  [[ "$left_canary_host" == "$right_canary_host" &&
    "$left_primary_host" == "$right_primary_host" ]] ||
    fail "$error_code"
}

wait_for_url() {
  local url="$1"
  local timeout_seconds="${2:-120}"
  [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || fail "ready_timeout_invalid"
  (( timeout_seconds >= 1 && timeout_seconds <= 120 )) || fail "ready_timeout_invalid"
  local started_at="$SECONDS"
  while (( SECONDS - started_at < timeout_seconds )); do
    if curl --fail --silent --show-error \
      --connect-timeout 5 --max-time 10 --output /dev/null -- "$url"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

atomic_write() {
  local destination="$1"
  local contents="$2"
  local mode="${3:-600}"
  local directory
  local base
  local temporary
  directory="$(dirname -- "$destination")"
  base="$(basename -- "$destination")"
  [[ -d "$directory" ]] || fail "atomic_write_directory_missing"
  temporary="$(mktemp "${directory}/.${base}.tmp.XXXXXX")"
  if ! printf '%s' "$contents" > "$temporary"; then
    rm -f -- "$temporary"
    fail "atomic_write_failed"
  fi
  chmod "$mode" -- "$temporary" || {
    rm -f -- "$temporary"
    fail "atomic_write_failed"
  }
  sync -f -- "$temporary" || {
    rm -f -- "$temporary"
    fail "atomic_write_failed"
  }
  if ! mv -f -- "$temporary" "$destination"; then
    rm -f -- "$temporary" || fail "atomic_write_cleanup_failed"
    fail "atomic_write_failed"
  fi
  sync -f -- "$directory" || fail "atomic_write_failed"
}

declare -gA RELEASE_MANIFEST=()

parse_release_manifest() {
  local manifest="$1"
  local line
  local key
  local value
  local required_key
  local optional_image_key
  [[ -f "$manifest" ]] || fail "release_manifest_missing"
  RELEASE_MANIFEST=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" != *$'\r'* ]] || fail "manifest_malformed_line"
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail "manifest_malformed_line"
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$key" in
      RELEASE_SCHEMA|RELEASE_SHA|API_IMAGE|DM_WORKER_IMAGE|WIKI_WORKER_IMAGE|CONTENT_PROPOSAL_WORKER_IMAGE|CADDY_IMAGE|CANARY_HOST|PRIMARY_HOST|ACME_EMAIL|API_ENV_FILE) ;;
      *) fail "manifest_unknown_key" ;;
    esac
    [[ ! -v "RELEASE_MANIFEST[$key]" ]] || fail "manifest_duplicate_key"
    [[ -n "$value" ]] || fail "manifest_value_missing"
    RELEASE_MANIFEST["$key"]="$value"
  done < "$manifest"

  for required_key in \
    RELEASE_SCHEMA RELEASE_SHA API_IMAGE CADDY_IMAGE \
    CANARY_HOST PRIMARY_HOST ACME_EMAIL API_ENV_FILE; do
    [[ -v "RELEASE_MANIFEST[$required_key]" ]] || fail "manifest_required_key_missing"
  done

  [[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "1" ]] || fail "release_schema_unsupported"
  require_release_sha "${RELEASE_MANIFEST[RELEASE_SHA]}"
  require_digest_image "${RELEASE_MANIFEST[API_IMAGE]}"
  for optional_image_key in DM_WORKER_IMAGE WIKI_WORKER_IMAGE CONTENT_PROPOSAL_WORKER_IMAGE; do
    if [[ -v "RELEASE_MANIFEST[$optional_image_key]" ]]; then
      require_digest_image "${RELEASE_MANIFEST[$optional_image_key]}"
    fi
  done
  require_digest_image "${RELEASE_MANIFEST[CADDY_IMAGE]}"
  require_hostname "${RELEASE_MANIFEST[CANARY_HOST]}"
  require_hostname "${RELEASE_MANIFEST[PRIMARY_HOST]}"
  [[ "${RELEASE_MANIFEST[CANARY_HOST]}" != "${RELEASE_MANIFEST[PRIMARY_HOST]}" ]] ||
    fail "manifest_hosts_must_differ"
  [[ "${RELEASE_MANIFEST[ACME_EMAIL]}" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$ ]] ||
    fail "manifest_acme_email_invalid"
  [[ "${RELEASE_MANIFEST[API_ENV_FILE]}" =~ ^/[a-zA-Z0-9._/-]+$ ]] ||
    fail "manifest_api_env_file_invalid"
}

validate_release_manifest() {
  local manifest="$1"
  local checksum_file="${manifest}.sha256"
  local checksum_line
  local expected_checksum
  local actual_checksum
  local -a checksum_lines=()
  require_file_mode_600 "$manifest"
  [[ -f "$checksum_file" ]] || fail "release_checksum_missing"
  mapfile -t checksum_lines < "$checksum_file"
  [[ "${#checksum_lines[@]}" -eq 1 ]] || fail "release_checksum_invalid"
  checksum_line="${checksum_lines[0]}"
  [[ "$checksum_line" =~ ^([a-f0-9]{64})[[:space:]][[:space:]]release\.env$ ]] ||
    fail "release_checksum_invalid"
  expected_checksum="${BASH_REMATCH[1]}"
  actual_checksum="$(sha256sum -- "$manifest" | awk '{print $1}')"
  [[ "$actual_checksum" == "$expected_checksum" ]] || fail "release_checksum_mismatch"
  parse_release_manifest "$manifest"
}

validate_release_directory() {
  local release_directory="$1"
  [[ -d "$release_directory" && ! -L "$release_directory" ]] || fail "release_directory_invalid"
  validate_release_integrity "$release_directory"
  validate_release_manifest "$release_directory/release.env"
  [[ "$(basename -- "$release_directory")" == "${RELEASE_MANIFEST[RELEASE_SHA]}" ]] ||
    fail "release_directory_sha_mismatch"
}

release_file_specs() {
  printf '%s\n' \
    "600 release.env" \
    "600 release.env.sha256" \
    "644 compose.production.yml" \
    "644 Caddyfile" \
    "644 Caddyfile.canary" \
    "755 scripts/lib.sh" \
    "755 scripts/preflight.sh" \
    "755 scripts/deploy.sh" \
    "755 scripts/verify-canary.sh" \
    "755 scripts/promote.sh" \
    "755 scripts/rollback.sh" \
    "755 scripts/backup-state.sh" \
    "755 scripts/restore-state.sh"
}

require_release_file() {
  local path="$1"
  local expected_mode="$2"
  [[ -f "$path" && ! -L "$path" ]] || fail "release_file_invalid"
  [[ "$(stat -c '%a' -- "$path")" == "$expected_mode" ]] || fail "release_file_mode_invalid"
  [[ "$(stat -c '%U' -- "$path")" == "bpdeploy" ]] || fail "release_file_owner_invalid"
}

build_release_integrity() {
  local release_directory="$1"
  local mode
  local relative
  local checksum
  local ignored_path
  local index=0
  local -a modes=()
  local -a relatives=()
  local -a paths=()
  while read -r mode relative; do
    require_release_file "$release_directory/$relative" "$mode"
    modes+=("$mode")
    relatives+=("$relative")
    paths+=("$release_directory/$relative")
  done < <(release_file_specs)
  while read -r checksum ignored_path; do
    [[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || fail "release_integrity_checksum_invalid"
    [[ "$index" -lt "${#paths[@]}" ]] || fail "release_integrity_count_invalid"
    printf '%s  %s  %s\n' "$checksum" "${modes[$index]}" "${relatives[$index]}"
    index=$((index + 1))
  done < <(sha256sum -- "${paths[@]}")
  [[ "$index" -eq "${#paths[@]}" ]] || fail "release_integrity_count_invalid"
}

generate_release_integrity() {
  local release_directory="$1"
  local contents
  contents="$(build_release_integrity "$release_directory")"$'\n'
  atomic_write "$release_directory/release-integrity.sha256" "$contents" 600
}

validate_release_integrity() {
  local release_directory="$1"
  local integrity_file="$release_directory/release-integrity.sha256"
  local expected
  local actual
  require_release_file "$integrity_file" 600
  expected="$(build_release_integrity "$release_directory")"
  actual="$(<"$integrity_file")"
  [[ "$actual" == "$expected" ]] || fail "release_integrity_mismatch"
}

require_secure_state_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || fail "state_file_invalid"
  [[ "$(stat -c '%a' -- "$path")" == "600" ]] || fail "state_file_mode_invalid"
  [[ "$(stat -c '%U' -- "$path")" == "bpdeploy" ]] || fail "state_file_owner_invalid"
}

load_optional_state_sha() {
  local path="$1"
  local output_variable="$2"
  local value
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    return 1
  fi
  require_secure_state_file "$path"
  value="$(<"$path")"
  [[ "$value" =~ ^[a-f0-9]{40}$ ]] || fail "state_sha_invalid"
  printf -v "$output_variable" '%s' "$value"
}

load_required_state_sha() {
  local path="$1"
  local output_variable="$2"
  load_optional_state_sha "$path" "$output_variable" || fail "state_file_missing"
}

atomic_write_state() {
  local destination="$1"
  local contents="$2"
  if [[ -e "$destination" || -L "$destination" ]]; then
    require_secure_state_file "$destination"
  fi
  atomic_write "$destination" "$contents" 600
  require_secure_state_file "$destination"
}

remove_state_file() {
  local path="$1"
  local directory
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    return 0
  fi
  require_secure_state_file "$path"
  directory="$(dirname -- "$path")"
  rm -f -- "$path" || fail "state_file_cleanup_failed"
  sync -f -- "$directory" || fail "state_file_cleanup_failed"
}

state_value_or_none() {
  local path="$1"
  local output_variable="$2"
  local loaded_sha=""
  if load_optional_state_sha "$path" loaded_sha; then
    printf -v "$output_variable" '%s' "$loaded_sha"
  else
    printf -v "$output_variable" '%s' "NONE"
  fi
}

prepared_state_flag() {
  local path="$1"
  local output_variable="$2"
  if [[ -e "$path" || -L "$path" ]]; then
    require_secure_state_file "$path"
    printf -v "$output_variable" '%s' "1"
  else
    printf -v "$output_variable" '%s' "0"
  fi
}

begin_transition() {
  local root="$1"
  local operation="$2"
  local deployment_phase="$3"
  local transition_phase="$4"
  local from_current="$5"
  local from_candidate="$6"
  local from_previous="$7"
  local from_prepared="$8"
  local to_release="$9"
  local journal="$root/state/transition.journal"
  [[ ! -e "$journal" && ! -L "$journal" ]] || fail "transition_journal_exists"
  [[ "$operation" == "deploy" || "$operation" == "promote" || "$operation" == "rollback" ]] ||
    fail "transition_journal_invalid"
  [[ "$deployment_phase" == "canary" || "$deployment_phase" == "production" ]] ||
    fail "transition_journal_invalid"
  [[ "$transition_phase" =~ ^[a-z_]+$ ]] || fail "transition_journal_invalid"
  local value
  for value in "$from_current" "$from_candidate" "$from_previous"; do
    [[ "$value" == "NONE" || "$value" =~ ^[a-f0-9]{40}$ ]] ||
      fail "transition_journal_invalid"
  done
  [[ "$from_prepared" == "0" || "$from_prepared" == "1" ]] ||
    fail "transition_journal_invalid"
  require_release_sha "$to_release"
  local contents
  printf -v contents \
    'JOURNAL_SCHEMA=1\nOPERATION=%s\nDEPLOYMENT_PHASE=%s\nTRANSITION_PHASE=%s\nFROM_CURRENT=%s\nFROM_CANDIDATE=%s\nFROM_PREVIOUS=%s\nFROM_PREPARED=%s\nTO_RELEASE=%s\n' \
    "$operation" "$deployment_phase" "$transition_phase" "$from_current" \
    "$from_candidate" "$from_previous" "$from_prepared" "$to_release"
  atomic_write_state "$journal" "$contents"
}

declare -gA TRANSITION_JOURNAL=()

parse_transition_journal() {
  local journal="$1"
  local line
  local key
  local value
  local required_key
  require_secure_state_file "$journal"
  TRANSITION_JOURNAL=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" != *$'\r'* ]] || fail "transition_journal_invalid"
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail "transition_journal_invalid"
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$key" in
      JOURNAL_SCHEMA|OPERATION|DEPLOYMENT_PHASE|TRANSITION_PHASE|FROM_CURRENT|FROM_CANDIDATE|FROM_PREVIOUS|FROM_PREPARED|TO_RELEASE) ;;
      *) fail "transition_journal_invalid" ;;
    esac
    [[ ! -v "TRANSITION_JOURNAL[$key]" ]] || fail "transition_journal_invalid"
    [[ -n "$value" ]] || fail "transition_journal_invalid"
    TRANSITION_JOURNAL["$key"]="$value"
  done < "$journal"
  for required_key in \
    JOURNAL_SCHEMA OPERATION DEPLOYMENT_PHASE TRANSITION_PHASE \
    FROM_CURRENT FROM_CANDIDATE FROM_PREVIOUS FROM_PREPARED TO_RELEASE; do
    [[ -v "TRANSITION_JOURNAL[$required_key]" ]] || fail "transition_journal_invalid"
  done
  [[ "${TRANSITION_JOURNAL[JOURNAL_SCHEMA]}" == "1" ]] || fail "transition_journal_invalid"
  [[ "${TRANSITION_JOURNAL[OPERATION]}" == "deploy" ||
    "${TRANSITION_JOURNAL[OPERATION]}" == "promote" ||
    "${TRANSITION_JOURNAL[OPERATION]}" == "rollback" ]] || fail "transition_journal_invalid"
  [[ "${TRANSITION_JOURNAL[DEPLOYMENT_PHASE]}" == "canary" ||
    "${TRANSITION_JOURNAL[DEPLOYMENT_PHASE]}" == "production" ]] ||
    fail "transition_journal_invalid"
  [[ "${TRANSITION_JOURNAL[TRANSITION_PHASE]}" =~ ^[a-z_]+$ ]] ||
    fail "transition_journal_invalid"
  local state_value
  for state_value in FROM_CURRENT FROM_CANDIDATE FROM_PREVIOUS; do
    value="${TRANSITION_JOURNAL[$state_value]}"
    [[ "$value" == "NONE" || "$value" =~ ^[a-f0-9]{40}$ ]] ||
      fail "transition_journal_invalid"
  done
  [[ "${TRANSITION_JOURNAL[FROM_PREPARED]}" == "0" ||
    "${TRANSITION_JOURNAL[FROM_PREPARED]}" == "1" ]] ||
    fail "transition_journal_invalid"
  require_release_sha "${TRANSITION_JOURNAL[TO_RELEASE]}"
}

restore_sha_state() {
  local path="$1"
  local value="$2"
  local existing_value=""
  if [[ "$value" == "NONE" ]]; then
    remove_state_file "$path"
  elif load_optional_state_sha "$path" existing_value &&
    [[ "$existing_value" == "$value" ]]; then
    return 0
  else
    atomic_write_state "$path" "${value}"$'\n'
  fi
}

reconcile_transition() {
  local root="$1"
  local ready_timeout_seconds="${2:-120}"
  local journal="$root/state/transition.journal"
  [[ -e "$journal" || -L "$journal" ]] || return 0
  parse_transition_journal "$journal"

  local from_current="${TRANSITION_JOURNAL[FROM_CURRENT]}"
  local from_candidate="${TRANSITION_JOURNAL[FROM_CANDIDATE]}"
  local from_previous="${TRANSITION_JOURNAL[FROM_PREVIOUS]}"
  local deployment_phase="${TRANSITION_JOURNAL[DEPLOYMENT_PHASE]}"
  local current_api_image=""
  local current_caddy_image=""
  local current_canary_host=""
  local current_primary_host=""
  local candidate_api_image=""
  local candidate_caddy_image=""
  local candidate_canary_host=""
  local candidate_primary_host=""
  local target_canary_host=""
  local target_primary_host=""
  local restore_sha=""
  local restore_directory=""
  local -a restore_compose=()

  if [[ "$from_current" != "NONE" ]]; then
    validate_release_directory "$root/releases/$from_current"
    current_api_image="${RELEASE_MANIFEST[API_IMAGE]}"
    current_caddy_image="${RELEASE_MANIFEST[CADDY_IMAGE]}"
    current_canary_host="${RELEASE_MANIFEST[CANARY_HOST]}"
    current_primary_host="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  fi
  if [[ "$from_candidate" != "NONE" ]]; then
    validate_release_directory "$root/releases/$from_candidate"
    candidate_api_image="${RELEASE_MANIFEST[API_IMAGE]}"
    candidate_caddy_image="${RELEASE_MANIFEST[CADDY_IMAGE]}"
    candidate_canary_host="${RELEASE_MANIFEST[CANARY_HOST]}"
    candidate_primary_host="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  fi
  if [[ "$from_previous" != "NONE" ]]; then
    validate_release_directory "$root/releases/$from_previous"
  fi
  validate_release_directory "$root/releases/${TRANSITION_JOURNAL[TO_RELEASE]}"
  target_canary_host="${RELEASE_MANIFEST[CANARY_HOST]}"
  target_primary_host="${RELEASE_MANIFEST[PRIMARY_HOST]}"

  if [[ "$from_current" != "NONE" && "$from_candidate" != "NONE" ]]; then
    require_matching_host_pair \
      "$current_canary_host" "$current_primary_host" \
      "$candidate_canary_host" "$candidate_primary_host"
  fi
  if [[ "$from_current" != "NONE" ]]; then
    require_matching_host_pair \
      "$current_canary_host" "$current_primary_host" \
      "$target_canary_host" "$target_primary_host"
  fi
  if [[ "$from_candidate" != "NONE" ]]; then
    require_matching_host_pair \
      "$candidate_canary_host" "$candidate_primary_host" \
      "$target_canary_host" "$target_primary_host"
  fi
  if [[ "$deployment_phase" == "production" &&
    "$from_current" == "NONE" && "$from_candidate" == "NONE" ]]; then
    fail "transition_journal_invalid"
  fi

  if [[ "$deployment_phase" == "production" ]]; then
    if [[ "$from_current" != "NONE" ]]; then
      restore_sha="$from_current"
      restore_directory="$root/releases/$restore_sha"
      export PRIMARY_API_IMAGE="$current_api_image"
      export CANDIDATE_API_IMAGE="${candidate_api_image:-$current_api_image}"
      export CADDY_IMAGE="$current_caddy_image"
      export CADDYFILE_PATH="$restore_directory/Caddyfile"
      restore_compose=(docker compose -p brand-pilot -f "$restore_directory/compose.production.yml" --env-file "$restore_directory/release.env")
      "${restore_compose[@]}" up -d --no-deps --pull never --wait \
        --wait-timeout "$ready_timeout_seconds" api-primary || return 1
      "${restore_compose[@]}" up -d --no-deps --pull never caddy || return 1
      wait_for_local_https "$current_primary_host" "$ready_timeout_seconds" ||
        fail "transition_recovery_readiness_failed"
    else
      [[ "$from_candidate" != "NONE" ]] || fail "transition_journal_invalid"
      restore_directory="$root/releases/$from_candidate"
      export PRIMARY_API_IMAGE="$candidate_api_image"
      export CANDIDATE_API_IMAGE="$candidate_api_image"
      export CADDY_IMAGE="$candidate_caddy_image"
      export CADDYFILE_PATH="$restore_directory/Caddyfile.canary"
      restore_compose=(docker compose -p brand-pilot -f "$restore_directory/compose.production.yml" --env-file "$restore_directory/release.env")
      "${restore_compose[@]}" up -d --no-deps --pull never caddy || return 1
      wait_for_local_https "$candidate_canary_host" "$ready_timeout_seconds" ||
        fail "transition_recovery_readiness_failed"
      "${restore_compose[@]}" stop api-primary >/dev/null || return 1
      "${restore_compose[@]}" rm -f api-primary >/dev/null || return 1
    fi
  else
    if [[ "$from_candidate" != "NONE" ]]; then
      restore_directory="$root/releases/$from_candidate"
      export PRIMARY_API_IMAGE="${current_api_image:-$candidate_api_image}"
      export CANDIDATE_API_IMAGE="$candidate_api_image"
      restore_compose=(docker compose -p brand-pilot -f "$restore_directory/compose.production.yml" --env-file "$restore_directory/release.env")
      "${restore_compose[@]}" up -d --no-deps --pull never --wait \
        --wait-timeout "$ready_timeout_seconds" api-canary || return 1
      if [[ "$from_current" == "NONE" ]]; then
        export CADDY_IMAGE="$candidate_caddy_image"
        export CADDYFILE_PATH="$restore_directory/Caddyfile.canary"
        "${restore_compose[@]}" up -d --no-deps --pull never caddy || return 1
      fi
      wait_for_local_https "$candidate_canary_host" "$ready_timeout_seconds" ||
        fail "transition_recovery_readiness_failed"
    else
      restore_sha="${TRANSITION_JOURNAL[TO_RELEASE]}"
      restore_directory="$root/releases/$restore_sha"
      validate_release_directory "$restore_directory"
      export PRIMARY_API_IMAGE="${current_api_image:-${RELEASE_MANIFEST[API_IMAGE]}}"
      export CANDIDATE_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
      export CADDY_IMAGE="${RELEASE_MANIFEST[CADDY_IMAGE]}"
      export CADDYFILE_PATH="$restore_directory/Caddyfile.canary"
      restore_compose=(docker compose -p brand-pilot -f "$restore_directory/compose.production.yml" --env-file "$restore_directory/release.env")
      "${restore_compose[@]}" stop api-canary >/dev/null || return 1
      "${restore_compose[@]}" rm -f api-canary >/dev/null || return 1
      if [[ "$from_current" == "NONE" ]]; then
        "${restore_compose[@]}" stop caddy >/dev/null || return 1
        "${restore_compose[@]}" rm -f caddy >/dev/null || return 1
      fi
    fi
  fi

  restore_sha_state "$root/state/current" "$from_current"
  restore_sha_state "$root/state/candidate" "$from_candidate"
  restore_sha_state "$root/state/previous" "$from_previous"
  remove_state_file "$root/state/prepared"
  remove_state_file "$journal"
  status_ok "transition_recovery"
}

reconcile_transition_or_fail() {
  if ! (reconcile_transition "$@"); then
    printf 'error=recovery_failed\n' >&2
    exit 70
  fi
}

release_preparation_fingerprint() {
  local release_directory="$1"
  local integrity_checksum
  integrity_checksum="$(sha256sum -- "$release_directory/release-integrity.sha256" | awk '{print $1}')"
  printf '%s\n%s\n%s\n%s\n' \
    "${RELEASE_MANIFEST[RELEASE_SHA]}" \
    "${RELEASE_MANIFEST[API_IMAGE]}" \
    "${RELEASE_MANIFEST[CADDY_IMAGE]}" \
    "$integrity_checksum" |
    sha256sum | awk '{print $1}'
}

write_prepared_proof() {
  local destination="$1"
  local release_directory="$2"
  local fingerprint
  fingerprint="$(release_preparation_fingerprint "$release_directory")"
  atomic_write_state "$destination" \
    "RELEASE_SHA=${RELEASE_MANIFEST[RELEASE_SHA]}"$'\n'"PREPARATION_FINGERPRINT=${fingerprint}"$'\n'
}

validate_prepared_proof() {
  local path="$1"
  local release_directory="$2"
  local line
  local expected_fingerprint
  local proof_sha=""
  local proof_fingerprint=""
  local -a proof_lines=()
  [[ -e "$path" || -L "$path" ]] || fail "promotion_not_prepared"
  require_secure_state_file "$path"
  mapfile -t proof_lines < "$path"
  [[ "${#proof_lines[@]}" -eq 2 ]] || fail "promotion_prepared_proof_invalid"
  for line in "${proof_lines[@]}"; do
    case "$line" in
      RELEASE_SHA=*) proof_sha="${line#RELEASE_SHA=}" ;;
      PREPARATION_FINGERPRINT=*) proof_fingerprint="${line#PREPARATION_FINGERPRINT=}" ;;
      *) fail "promotion_prepared_proof_invalid" ;;
    esac
  done
  require_release_sha "$proof_sha"
  [[ "$proof_fingerprint" =~ ^[a-f0-9]{64}$ ]] || fail "promotion_prepared_proof_invalid"
  [[ "$proof_sha" == "${RELEASE_MANIFEST[RELEASE_SHA]}" ]] || fail "promotion_prepared_proof_mismatch"
  expected_fingerprint="$(release_preparation_fingerprint "$release_directory")"
  [[ "$proof_fingerprint" == "$expected_fingerprint" ]] || fail "promotion_prepared_proof_mismatch"
}

wait_for_local_https() {
  local host="$1"
  local timeout_seconds="${2:-120}"
  require_hostname "$host"
  [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || fail "ready_timeout_invalid"
  local started_at="$SECONDS"
  while (( SECONDS - started_at < timeout_seconds )); do
    if curl --fail --silent --show-error \
      --connect-timeout 5 --max-time 10 --output /dev/null \
      --resolve "${host}:443:127.0.0.1" -- "https://${host}/ready"; then
      return 0
    fi
    sleep 1
  done
  return 1
}
