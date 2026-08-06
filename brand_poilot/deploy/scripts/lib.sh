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

configure_codex_runtime_identity_if_available() {
  local runtime_uid
  local runtime_gid
  command -v id >/dev/null 2>&1 || return 0
  runtime_uid="$(id -u bpdeploy 2>/dev/null)" || return 0
  runtime_gid="$(id -g bpdeploy 2>/dev/null)" || return 0
  [[ "$runtime_uid" =~ ^[0-9]+$ && "$runtime_gid" =~ ^[0-9]+$ ]] || return 0
  (( runtime_uid > 0 && runtime_gid > 0 )) || return 0
  export CODEX_RUNTIME_UID="$runtime_uid"
  export CODEX_RUNTIME_GID="$runtime_gid"
}

configure_codex_runtime_identity_if_available

require_file_mode_600() {
  local file="$1"
  local expected_owner="${2:-}"
  [[ -f "$file" && ! -L "$file" ]] || fail "required_file_missing"
  [[ "$(stat -c '%a' -- "$file")" == "600" ]] || fail "required_file_mode_invalid"
  if [[ -n "$expected_owner" ]]; then
    [[ "$(stat -c '%U' -- "$file")" == "$expected_owner" ]] || fail "required_file_owner_invalid"
  fi
}

require_exact_boolean() {
  local key="$1"
  local expected="$2"
  local file="$3"
  local exact_count
  local key_count
  [[ "$expected" == "true" || "$expected" == "false" ]] || fail "safe_runtime_flag_expectation_invalid"
  exact_count="$(grep -Ec "^${key}=${expected}$" "$file" || true)"
  key_count="$(grep -Ec "^${key}=" "$file" || true)"
  [[ "$exact_count" == "1" && "$key_count" == "1" ]] || fail "safe_runtime_flag_invalid"
  status_ok "$key"
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

declare -g MARKETING_RETIREMENT_SOURCE_SCHEMA=""
declare -g MARKETING_RETIREMENT_SOURCE_RELEASE_SHA=""
declare -g MARKETING_RETIREMENT_SOURCE_MANIFEST_SHA256=""
declare -g MARKETING_RETIREMENT_LEGACY_IMAGE=""
declare -g MARKETING_RETIREMENT_LEGACY_SOURCE_SHA=""

validate_marketing_retirement_record() {
  local record_file="$1"
  local line
  local record_pattern
  local -a record_lines=()
  [[ -f "$record_file" && ! -L "$record_file" ]] ||
    fail "marketing_retirement_record_missing"
  mapfile -t record_lines < "$record_file"
  [[ "${#record_lines[@]}" -eq 1 ]] || fail "marketing_retirement_record_invalid"
  line="${record_lines[0]}"
  [[ "$line" != *$'\r'* ]] || fail "marketing_retirement_record_invalid"
  record_pattern='^\{"contractVersion":"marketing-worker-retirement\.v1","action":"stop_remove","service":"marketing-worker-1","restartAllowed":false,"sourceReleaseSchema":"[12]","sourceReleaseSha":"[a-f0-9]{40}","sourceManifestSha256":"[a-f0-9]{64}","legacyImage":"[a-zA-Z0-9._@:/-]+","legacySourceSha":"[a-f0-9]{40}"\}$'
  [[ "$line" =~ $record_pattern ]] || fail "marketing_retirement_record_invalid"

  MARKETING_RETIREMENT_SOURCE_SCHEMA="$(sed -E 's/^.*"sourceReleaseSchema":"([12])".*$/\1/' <<<"$line")"
  MARKETING_RETIREMENT_SOURCE_RELEASE_SHA="$(sed -E 's/^.*"sourceReleaseSha":"([a-f0-9]{40})".*$/\1/' <<<"$line")"
  MARKETING_RETIREMENT_SOURCE_MANIFEST_SHA256="$(sed -E 's/^.*"sourceManifestSha256":"([a-f0-9]{64})".*$/\1/' <<<"$line")"
  MARKETING_RETIREMENT_LEGACY_IMAGE="$(sed -E 's/^.*"legacyImage":"([^"]+)".*$/\1/' <<<"$line")"
  MARKETING_RETIREMENT_LEGACY_SOURCE_SHA="$(sed -E 's/^.*"legacySourceSha":"([a-f0-9]{40})".*$/\1/' <<<"$line")"
  require_release_sha "$MARKETING_RETIREMENT_SOURCE_RELEASE_SHA"
  require_release_sha "$MARKETING_RETIREMENT_LEGACY_SOURCE_SHA"
  require_digest_image "$MARKETING_RETIREMENT_LEGACY_IMAGE"
}

legacy_release_manifest_value() {
  local manifest="$1"
  local key="$2"
  local -a values=()
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail "legacy_manifest_key_invalid"
  mapfile -t values < <(sed -n "s/^${key}=//p" "$manifest")
  [[ "${#values[@]}" -eq 1 && -n "${values[0]}" && "${values[0]}" != *$'\r'* ]] ||
    fail "legacy_manifest_value_invalid"
  printf '%s' "${values[0]}"
}

validate_legacy_marketing_cutover_source() {
  local release_directory="$1"
  local manifest="$release_directory/release.env"
  local actual_manifest_sha256
  local legacy_schema
  local legacy_release_sha
  local legacy_image
  local legacy_source_sha
  [[ -n "$MARKETING_RETIREMENT_SOURCE_RELEASE_SHA" ]] ||
    fail "marketing_retirement_record_not_loaded"
  [[ -d "$release_directory" && ! -L "$release_directory" ]] ||
    fail "legacy_release_directory_invalid"
  [[ "$(basename -- "$release_directory")" == "$MARKETING_RETIREMENT_SOURCE_RELEASE_SHA" ]] ||
    fail "marketing_retirement_source_release_mismatch"
  validate_release_integrity "$release_directory" legacy-current
  validate_release_manifest_checksum "$manifest"
  actual_manifest_sha256="$(sha256sum -- "$manifest" | awk '{print $1}')"
  [[ "$actual_manifest_sha256" == "$MARKETING_RETIREMENT_SOURCE_MANIFEST_SHA256" ]] ||
    fail "marketing_retirement_source_manifest_mismatch"

  legacy_schema="$(legacy_release_manifest_value "$manifest" RELEASE_SCHEMA)"
  legacy_release_sha="$(legacy_release_manifest_value "$manifest" RELEASE_SHA)"
  legacy_image="$(legacy_release_manifest_value "$manifest" MARKETING_WORKER_IMAGE)"
  [[ "$legacy_schema" == "$MARKETING_RETIREMENT_SOURCE_SCHEMA" ]] ||
    fail "marketing_retirement_source_schema_mismatch"
  [[ "$legacy_release_sha" == "$MARKETING_RETIREMENT_SOURCE_RELEASE_SHA" ]] ||
    fail "marketing_retirement_source_release_mismatch"
  [[ "$legacy_image" == "$MARKETING_RETIREMENT_LEGACY_IMAGE" ]] ||
    fail "marketing_retirement_legacy_image_mismatch"
  if [[ "$legacy_schema" == "2" ]]; then
    legacy_source_sha="$(legacy_release_manifest_value "$manifest" MARKETING_WORKER_SOURCE_SHA)"
  else
    legacy_source_sha="$legacy_release_sha"
  fi
  [[ "$legacy_source_sha" == "$MARKETING_RETIREMENT_LEGACY_SOURCE_SHA" ]] ||
    fail "marketing_retirement_legacy_source_mismatch"
}

retire_legacy_marketing_worker() {
  local release_directory="$1"
  local running_image
  local -a container_ids=()
  local -a legacy_compose=(
    docker compose -p brand-pilot
    -f "$release_directory/compose.production.yml"
    --env-file "$release_directory/release.env"
    --profile marketing-worker-1
  )
  validate_legacy_marketing_cutover_source "$release_directory"
  "${legacy_compose[@]}" config --quiet >/dev/null ||
    fail "marketing_retirement_compose_invalid"
  mapfile -t container_ids < <("${legacy_compose[@]}" ps -a -q marketing-worker-1)
  if [[ "${#container_ids[@]}" -eq 0 ]]; then
    printf '%s\n' "marketing_worker_retirement=already_absent"
    return 0
  fi
  [[ "${#container_ids[@]}" -eq 1 && "${container_ids[0]}" =~ ^[0-9a-f]{12,64}$ ]] ||
    fail "marketing_retirement_container_identity_invalid"
  running_image="$(docker inspect --format '{{.Config.Image}}' "${container_ids[0]}")" ||
    fail "marketing_retirement_container_inspect_failed"
  [[ "$running_image" == "$MARKETING_RETIREMENT_LEGACY_IMAGE" ]] ||
    fail "marketing_retirement_running_image_mismatch"
  "${legacy_compose[@]}" stop --timeout 30 marketing-worker-1 >/dev/null ||
    fail "marketing_retirement_stop_failed"
  "${legacy_compose[@]}" rm -f marketing-worker-1 >/dev/null ||
    fail "marketing_retirement_remove_failed"
  mapfile -t container_ids < <("${legacy_compose[@]}" ps -a -q marketing-worker-1)
  [[ "${#container_ids[@]}" -eq 0 ]] || fail "marketing_retirement_remove_unverified"
  printf '%s\n' "marketing_worker_retirement=ok"
}

readonly -a WORKER_IMAGE_KEYS=(
  DM_WORKER_IMAGE
  WIKI_WORKER_IMAGE
  CONTENT_PROPOSAL_WORKER_IMAGE
  BRAND_INTELLIGENCE_WORKER_IMAGE
  SUBJECT_ANALYSIS_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  REEL_WORKER_IMAGE
)
readonly -a RELEASE_IMAGE_KEYS=(API_IMAGE "${WORKER_IMAGE_KEYS[@]}")
readonly -a LEGACY_WORKER_IMAGE_KEYS=(
  DM_WORKER_IMAGE
  WIKI_WORKER_IMAGE
  CONTENT_PROPOSAL_WORKER_IMAGE
  BRAND_INTELLIGENCE_WORKER_IMAGE
  SUBJECT_ANALYSIS_WORKER_IMAGE
  IMAGE_WORKER_IMAGE
  CARD_NEWS_WORKER_IMAGE
  BLOG_WORKER_IMAGE
  MARKETING_WORKER_IMAGE
)
readonly -a LEGACY_RELEASE_IMAGE_KEYS=(API_IMAGE "${LEGACY_WORKER_IMAGE_KEYS[@]}")
readonly LEGACY_RELEASE_SHA="02aa2bcae3f66d494f16a26bec9055cac17464f9"

component_manifest_prefix() {
  local image_key="$1"
  [[ "$image_key" == *_IMAGE ]] || fail "component_image_key_invalid"
  printf '%s' "${image_key%_IMAGE}"
}

release_image_source_revision() {
  local image_key="$1"
  local prefix
  prefix="$(component_manifest_prefix "$image_key")"
  if [[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "2" ||
    "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "3" ]]; then
    printf '%s' "${RELEASE_MANIFEST[${prefix}_SOURCE_SHA]}"
  else
    printf '%s' "${RELEASE_MANIFEST[RELEASE_SHA]}"
  fi
}

release_image_changed() {
  local image_key="$1"
  local prefix
  prefix="$(component_manifest_prefix "$image_key")"
  if [[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "2" ||
    "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "3" ]]; then
    [[ "${RELEASE_MANIFEST[${prefix}_CHANGED]}" == "true" ]]
  else
    return 0
  fi
}

require_worker_image_manifest() {
  local required_image_key
  for required_image_key in "${WORKER_IMAGE_KEYS[@]}"; do
    [[ -v "RELEASE_MANIFEST[$required_image_key]" ]] ||
      fail "worker_image_manifest_missing"
    require_digest_image "${RELEASE_MANIFEST[$required_image_key]}"
  done
}

verify_release_image_revision() {
  local image="$1"
  local expected_revision="$2"
  local actual_revision
  require_digest_image "$image"
  require_release_sha "$expected_revision"
  actual_revision="$(docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$image" 2>/dev/null)" || fail "release_image_inspect_failed"
  [[ "$actual_revision" == "$expected_revision" ]] ||
    fail "release_image_revision_mismatch"
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
  local validation_role="${2:-candidate}"
  local line
  local key
  local value
  local required_key
  local release_image_key
  local prefix
  local source_key
  local changed_key
  local -a role_image_keys=()
  local -A allowed_keys=()
  [[ -f "$manifest" ]] || fail "release_manifest_missing"
  case "$validation_role" in
    candidate) role_image_keys=("${RELEASE_IMAGE_KEYS[@]}") ;;
    legacy-current) role_image_keys=("${LEGACY_RELEASE_IMAGE_KEYS[@]}") ;;
    *) fail "release_validation_role_invalid" ;;
  esac
  for key in RELEASE_SCHEMA RELEASE_SHA CADDY_IMAGE CANARY_HOST PRIMARY_HOST ACME_EMAIL API_ENV_FILE; do
    allowed_keys["$key"]=1
  done
  if [[ "$validation_role" == "candidate" ]]; then
    allowed_keys[MARKETING_RETIREMENT_SHA256]=1
  fi
  for release_image_key in "${role_image_keys[@]}"; do
    prefix="$(component_manifest_prefix "$release_image_key")"
    allowed_keys["$release_image_key"]=1
    allowed_keys["${prefix}_SOURCE_SHA"]=1
    allowed_keys["${prefix}_CHANGED"]=1
  done
  RELEASE_MANIFEST=()
  MARKETING_RETIREMENT_SOURCE_SCHEMA=""
  MARKETING_RETIREMENT_SOURCE_RELEASE_SHA=""
  MARKETING_RETIREMENT_SOURCE_MANIFEST_SHA256=""
  MARKETING_RETIREMENT_LEGACY_IMAGE=""
  MARKETING_RETIREMENT_LEGACY_SOURCE_SHA=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" != *$'\r'* ]] || fail "manifest_malformed_line"
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail "manifest_malformed_line"
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    [[ -v "allowed_keys[$key]" ]] || fail "manifest_unknown_key"
    [[ ! -v "RELEASE_MANIFEST[$key]" ]] || fail "manifest_duplicate_key"
    [[ -n "$value" ]] || fail "manifest_value_missing"
    RELEASE_MANIFEST["$key"]="$value"
  done < "$manifest"

  for required_key in \
    RELEASE_SCHEMA RELEASE_SHA API_IMAGE CADDY_IMAGE \
    CANARY_HOST PRIMARY_HOST ACME_EMAIL API_ENV_FILE; do
    [[ -v "RELEASE_MANIFEST[$required_key]" ]] || fail "manifest_required_key_missing"
  done

  if [[ "$validation_role" == "candidate" ]]; then
    [[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "3" ]] || fail "candidate_release_schema_required"
  else
    [[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "1" ||
      "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "2" ]] || fail "legacy_release_schema_required"
  fi
  require_release_sha "${RELEASE_MANIFEST[RELEASE_SHA]}"
  for release_image_key in "${role_image_keys[@]}"; do
    [[ -v "RELEASE_MANIFEST[$release_image_key]" ]] || fail "component_image_missing"
    require_digest_image "${RELEASE_MANIFEST[$release_image_key]}"
  done
  require_digest_image "${RELEASE_MANIFEST[CADDY_IMAGE]}"
  if [[ -v "RELEASE_MANIFEST[MARKETING_RETIREMENT_SHA256]" ]]; then
    local retirement_file retirement_checksum
    [[ "${RELEASE_MANIFEST[MARKETING_RETIREMENT_SHA256]}" =~ ^[a-f0-9]{64}$ ]] ||
      fail "marketing_retirement_checksum_invalid"
    retirement_file="$(dirname -- "$manifest")/marketing-worker-retirement.json"
    [[ -f "$retirement_file" && ! -L "$retirement_file" ]] ||
      fail "marketing_retirement_record_missing"
    retirement_checksum="$(sha256sum -- "$retirement_file" | awk '{print $1}')"
    [[ "$retirement_checksum" == "${RELEASE_MANIFEST[MARKETING_RETIREMENT_SHA256]}" ]] ||
      fail "marketing_retirement_checksum_mismatch"
    validate_marketing_retirement_record "$retirement_file"
  fi
  if [[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "2" || "$validation_role" == "candidate" ]]; then
    for release_image_key in "${role_image_keys[@]}"; do
      prefix="$(component_manifest_prefix "$release_image_key")"
      source_key="${prefix}_SOURCE_SHA"
      changed_key="${prefix}_CHANGED"
      [[ -v "RELEASE_MANIFEST[$source_key]" && -v "RELEASE_MANIFEST[$changed_key]" ]] ||
        fail "component_provenance_missing"
      require_release_sha "${RELEASE_MANIFEST[$source_key]}"
      [[ "${RELEASE_MANIFEST[$changed_key]}" == "true" ||
        "${RELEASE_MANIFEST[$changed_key]}" == "false" ]] ||
        fail "component_changed_invalid"
      if [[ "${RELEASE_MANIFEST[$changed_key]}" == "true" ]]; then
        [[ "${RELEASE_MANIFEST[$source_key]}" == "${RELEASE_MANIFEST[RELEASE_SHA]}" ]] ||
          fail "component_source_revision_mismatch"
      fi
    done
  else
    for release_image_key in "${role_image_keys[@]}"; do
      prefix="$(component_manifest_prefix "$release_image_key")"
      [[ ! -v "RELEASE_MANIFEST[${prefix}_SOURCE_SHA]" &&
        ! -v "RELEASE_MANIFEST[${prefix}_CHANGED]" ]] ||
        fail "legacy_schema1_provenance_forbidden"
    done
  fi
  require_hostname "${RELEASE_MANIFEST[CANARY_HOST]}"
  require_hostname "${RELEASE_MANIFEST[PRIMARY_HOST]}"
  [[ "${RELEASE_MANIFEST[CANARY_HOST]}" != "${RELEASE_MANIFEST[PRIMARY_HOST]}" ]] ||
    fail "manifest_hosts_must_differ"
  [[ "${RELEASE_MANIFEST[ACME_EMAIL]}" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$ ]] ||
    fail "manifest_acme_email_invalid"
  [[ "${RELEASE_MANIFEST[API_ENV_FILE]}" =~ ^/[a-zA-Z0-9._/-]+$ ]] ||
    fail "manifest_api_env_file_invalid"
}

validate_release_manifest_checksum() {
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
}

validate_release_manifest() {
  local manifest="$1"
  local validation_role="${2:-candidate}"
  validate_release_manifest_checksum "$manifest"
  parse_release_manifest "$manifest" "$validation_role"
}

validate_release_directory() {
  local release_directory="$1"
  local validation_role="${2:-candidate}"
  [[ -d "$release_directory" && ! -L "$release_directory" ]] || fail "release_directory_invalid"
  validate_release_integrity "$release_directory" "$validation_role"
  validate_release_manifest "$release_directory/release.env" "$validation_role"
  [[ "$(basename -- "$release_directory")" == "${RELEASE_MANIFEST[RELEASE_SHA]}" ]] ||
    fail "release_directory_sha_mismatch"
}

validate_state_release_directory() {
  local root="$1"
  local release_sha="$2"
  local validation_role="candidate"
  local release_manifest="$root/releases/$release_sha/release.env"
  require_release_sha "$release_sha"
  if [[ "$release_sha" == "$LEGACY_RELEASE_SHA" ]] ||
     [[ -f "$release_manifest" && "$(grep -Ec '^RELEASE_SCHEMA=[12]$' "$release_manifest")" == "1" ]]; then
    validation_role="legacy-current"
  fi
  validate_release_directory "$root/releases/$release_sha" "$validation_role"
}

release_file_specs() {
  local release_directory="${1:-}"
  local validation_role="${2:-candidate}"
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
    "755 scripts/rollback.sh"
  if [[ -f "$release_directory/release.env" ]] &&
     grep -Eq '^MARKETING_RETIREMENT_SHA256=[a-f0-9]{64}$' "$release_directory/release.env"; then
    printf '%s\n' "400 marketing-worker-retirement.json"
  fi
  if [[ "$validation_role" != "legacy-current" ]]; then
    printf '%s\n' \
      "755 scripts/rollout-workers.sh" \
      "755 scripts/backup-state.sh" \
      "755 scripts/restore-state.sh"
  else
    local optional_path
    for optional_path in scripts/rollout-workers.sh scripts/backup-state.sh scripts/restore-state.sh; do
      if [[ -f "$release_directory/release-integrity.sha256" ]] &&
         grep -Eq "^[a-f0-9]{64}  755  ${optional_path}$" "$release_directory/release-integrity.sha256"; then
        printf '755 %s\n' "$optional_path"
      fi
    done
  fi
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
  local validation_role="${2:-candidate}"
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
  done < <(release_file_specs "$release_directory" "$validation_role")
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
  local validation_role="${2:-candidate}"
  local integrity_file="$release_directory/release-integrity.sha256"
  local expected
  local actual
  require_release_file "$integrity_file" 600
  expected="$(build_release_integrity "$release_directory" "$validation_role")"
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

  local transition_retirement_source_sha=""
  validate_state_release_directory "$root" "${TRANSITION_JOURNAL[TO_RELEASE]}"
  target_canary_host="${RELEASE_MANIFEST[CANARY_HOST]}"
  target_primary_host="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  if [[ -v "RELEASE_MANIFEST[MARKETING_RETIREMENT_SHA256]" ]]; then
    transition_retirement_source_sha="$MARKETING_RETIREMENT_SOURCE_RELEASE_SHA"
  fi

  if [[ "$from_current" != "NONE" ]]; then
    if [[ -n "$transition_retirement_source_sha" && "$from_current" == "$transition_retirement_source_sha" ]]; then
      validate_state_release_directory "$root" "${TRANSITION_JOURNAL[TO_RELEASE]}"
      validate_legacy_marketing_cutover_source "$root/releases/$from_current"
      current_api_image="$(legacy_release_manifest_value "$root/releases/$from_current/release.env" API_IMAGE)"
      current_caddy_image="$(legacy_release_manifest_value "$root/releases/$from_current/release.env" CADDY_IMAGE)"
      current_canary_host="$(legacy_release_manifest_value "$root/releases/$from_current/release.env" CANARY_HOST)"
      current_primary_host="$(legacy_release_manifest_value "$root/releases/$from_current/release.env" PRIMARY_HOST)"
      require_digest_image "$current_api_image"
      require_digest_image "$current_caddy_image"
      require_hostname "$current_canary_host"
      require_hostname "$current_primary_host"
    else
      validate_state_release_directory "$root" "$from_current"
      current_api_image="${RELEASE_MANIFEST[API_IMAGE]}"
      current_caddy_image="${RELEASE_MANIFEST[CADDY_IMAGE]}"
      current_canary_host="${RELEASE_MANIFEST[CANARY_HOST]}"
      current_primary_host="${RELEASE_MANIFEST[PRIMARY_HOST]}"
    fi
  fi
  if [[ "$from_candidate" != "NONE" ]]; then
    validate_state_release_directory "$root" "$from_candidate"
    candidate_api_image="${RELEASE_MANIFEST[API_IMAGE]}"
    candidate_caddy_image="${RELEASE_MANIFEST[CADDY_IMAGE]}"
    candidate_canary_host="${RELEASE_MANIFEST[CANARY_HOST]}"
    candidate_primary_host="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  fi
  if [[ "$from_previous" != "NONE" ]]; then
    if [[ -n "$transition_retirement_source_sha" && "$from_previous" == "$transition_retirement_source_sha" ]]; then
      validate_state_release_directory "$root" "${TRANSITION_JOURNAL[TO_RELEASE]}"
      validate_legacy_marketing_cutover_source "$root/releases/$from_previous"
    else
      validate_state_release_directory "$root" "$from_previous"
    fi
  fi
  validate_state_release_directory "$root" "${TRANSITION_JOURNAL[TO_RELEASE]}"
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
  local worker_image_key
  integrity_checksum="$(sha256sum -- "$release_directory/release-integrity.sha256" | awk '{print $1}')"
  {
    printf '%s\n%s\n%s\n' \
      "${RELEASE_MANIFEST[RELEASE_SHA]}" \
      "${RELEASE_MANIFEST[API_IMAGE]}" \
      "$(release_image_source_revision API_IMAGE)"
    for worker_image_key in "${WORKER_IMAGE_KEYS[@]}"; do
      printf '%s\n%s\n' \
        "${RELEASE_MANIFEST[$worker_image_key]-}" \
        "$(release_image_source_revision "$worker_image_key")"
    done
    printf '%s\n%s\n' \
      "${RELEASE_MANIFEST[CADDY_IMAGE]}" \
      "$integrity_checksum"
  } | sha256sum | awk '{print $1}'
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
