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

require_boolean() {
  local key="$1"
  local file="$2"
  local valid_count
  local key_count
  valid_count="$(grep -Ec "^${key}=(true|false)$" "$file" || true)"
  key_count="$(grep -Ec "^${key}=" "$file" || true)"
  [[ "$valid_count" == "1" && "$key_count" == "1" ]] || fail "safe_runtime_flag_invalid"
  status_ok "$key"
}

require_number_range() {
  local key="$1"
  local minimum="$2"
  local maximum="$3"
  local file="$4"
  local value
  [[ "$(grep -Ec "^${key}=" "$file" || true)" == "1" ]] || fail "safe_runtime_number_invalid"
  value="$(grep -E "^${key}=" "$file" | sed 's/^[^=]*=//')"
  awk -v value="$value" -v minimum="$minimum" -v maximum="$maximum" \
    'BEGIN { if (value !~ /^[0-9]+([.][0-9]+)?$/ || value < minimum || value > maximum) exit 1 }' ||
    fail "safe_runtime_number_invalid"
  status_ok "$key"
}

require_integer_range() {
  local key="$1"
  local minimum="$2"
  local maximum="$3"
  local file="$4"
  local value
  [[ "$(grep -Ec "^${key}=" "$file" || true)" == "1" ]] || fail "safe_runtime_number_invalid"
  value="$(grep -E "^${key}=" "$file" | sed 's/^[^=]*=//')"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "safe_runtime_number_invalid"
  (( value >= minimum && value <= maximum )) || fail "safe_runtime_number_invalid"
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
declare -g MARKETING_RETIREMENT_BASELINE_MANIFEST_SHA256=""
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
  record_pattern='^\{"contractVersion":"marketing-worker-retirement\.v1","action":"stop_remove","service":"marketing-worker-1","restartAllowed":false,"sourceReleaseSchema":"[12]","sourceReleaseSha":"[a-f0-9]{40}","sourceManifestSha256":"[a-f0-9]{64}","baselineManifestSha256":"[a-f0-9]{64}","legacyImage":"[a-zA-Z0-9._@:/-]+","legacySourceSha":"[a-f0-9]{40}"\}$'
  [[ "$line" =~ $record_pattern ]] || fail "marketing_retirement_record_invalid"

  MARKETING_RETIREMENT_SOURCE_SCHEMA="$(sed -E 's/^.*"sourceReleaseSchema":"([12])".*$/\1/' <<<"$line")"
  MARKETING_RETIREMENT_SOURCE_RELEASE_SHA="$(sed -E 's/^.*"sourceReleaseSha":"([a-f0-9]{40})".*$/\1/' <<<"$line")"
  MARKETING_RETIREMENT_SOURCE_MANIFEST_SHA256="$(sed -E 's/^.*"sourceManifestSha256":"([a-f0-9]{64})".*$/\1/' <<<"$line")"
  MARKETING_RETIREMENT_BASELINE_MANIFEST_SHA256="$(sed -E 's/^.*"baselineManifestSha256":"([a-f0-9]{64})".*$/\1/' <<<"$line")"
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

require_publish_scheduler_image_manifest() {
  for key in PUBLISH_SCHEDULER_IMAGE PUBLISH_SCHEDULER_SOURCE_SHA PUBLISH_SCHEDULER_CHANGED; do
    [[ -v "RELEASE_MANIFEST[$key]" ]] || fail "publish_scheduler_image_manifest_missing"
  done
  require_digest_image "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_IMAGE]}"
  require_release_sha "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_SOURCE_SHA]}"
  [[ "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_CHANGED]}" == "true" ||
    "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_CHANGED]}" == "false" ]] ||
    fail "component_changed_invalid"
  if [[ "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_CHANGED]}" == "true" ]]; then
    [[ "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_SOURCE_SHA]}" == "${RELEASE_MANIFEST[RELEASE_SHA]}" ]] ||
      fail "component_source_revision_mismatch"
  fi
}

require_publish_scheduler_secret() {
  local root="$1"
  local api_env_file="$2"
  local secret_directory="$root/shared/secrets"
  local cron_secret_file="$secret_directory/cron-secret"
  local cron_secret
  local expected_digest
  local actual_digest

  [[ "$(grep -Ec '^CRON_SECRET=[A-Za-z0-9+/=_:.@%-]+$' "$api_env_file" || true)" == "1" ]] ||
    fail "publish_scheduler_secret_invalid"
  grep -Eq '^CRON_SECRET=required-at-deploy-time$' "$api_env_file" &&
    fail "publish_scheduler_secret_missing"
  cron_secret="$(grep -E '^CRON_SECRET=' "$api_env_file" | sed 's/^[^=]*=//')"
  [[ -n "$cron_secret" ]] || fail "publish_scheduler_secret_missing"

  if [[ ! -e "$secret_directory" && ! -L "$secret_directory" ]]; then
    install -d -m 0700 "$secret_directory"
  fi
  [[ -d "$secret_directory" && ! -L "$secret_directory" ]] ||
    fail "publish_scheduler_secret_directory_invalid"
  [[ "$(stat -c '%a' -- "$secret_directory")" == "700" ]] ||
    fail "publish_scheduler_secret_directory_invalid"

  expected_digest="$(printf '%s\n' "$cron_secret" | sha256sum | awk '{print $1}')"
  if [[ -e "$cron_secret_file" || -L "$cron_secret_file" ]]; then
    require_file_mode_600 "$cron_secret_file" "bpdeploy"
    actual_digest="$(sha256sum -- "$cron_secret_file" | awk '{print $1}')"
    [[ "$actual_digest" == "$expected_digest" ]] || fail "publish_scheduler_secret_mismatch"
  else
    atomic_write "$cron_secret_file" "${cron_secret}"$'\n' 600
    require_file_mode_600 "$cron_secret_file" "bpdeploy"
  fi
  printf '%s' "$cron_secret_file"
}

require_publish_scheduler_environment_file() {
  local file="$1"
  local index
  local -a actual=()
  local -a expected=(
    "PRIMARY_API_INTERNAL_URL=http://api-primary:4000"
    "CRON_SECRET_FILE=/run/secrets/cron-secret"
    "PUBLISH_TICK_MS=60000"
    "PUBLISH_TIMEOUT_MS=240000"
  )
  require_file_mode_600 "$file" "bpdeploy"
  mapfile -t actual < "$file"
  [[ "${#actual[@]}" -eq "${#expected[@]}" ]] ||
    fail "publish_scheduler_environment_unknown_key"
  for index in "${!expected[@]}"; do
    [[ "${actual[$index]}" == "${expected[$index]}" ]] ||
      fail "publish_scheduler_environment_unknown_key"
  done
}

validate_publish_scheduler_against_primary() {
  local current_sha="$1"
  local scheduler_image="${RELEASE_MANIFEST[PUBLISH_SCHEDULER_IMAGE]:-}"
  local scheduler_revision="${RELEASE_MANIFEST[PUBLISH_SCHEDULER_SOURCE_SHA]:-}"
  local api_revision="${RELEASE_MANIFEST[API_SOURCE_SHA]:-}"

  require_publish_scheduler_image_manifest
  [[ "${RELEASE_MANIFEST[RELEASE_SHA]}" == "$current_sha" ]] ||
    fail "publish_scheduler_release_sha_mismatch"
  [[ "$scheduler_revision" == "$api_revision" ]] ||
    fail "publish_scheduler_release_sha_mismatch"
  local actual_revision
  actual_revision="$(docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$scheduler_image" 2>/dev/null)" || fail "publish_scheduler_image_revision_mismatch"
  [[ "$actual_revision" == "$scheduler_revision" ]] ||
    fail "publish_scheduler_image_revision_mismatch"
}

export_release_compose_environment() {
  export PRIMARY_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
  export CANDIDATE_API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
  export CADDY_IMAGE="${RELEASE_MANIFEST[CADDY_IMAGE]}"
  export CANARY_HOST="${RELEASE_MANIFEST[CANARY_HOST]}"
  export PRIMARY_HOST="${RELEASE_MANIFEST[PRIMARY_HOST]}"
  export ACME_EMAIL="${RELEASE_MANIFEST[ACME_EMAIL]}"
  export API_ENV_FILE="${RELEASE_MANIFEST[API_ENV_FILE]}"
  export PUBLISH_SCHEDULER_IMAGE="${RELEASE_MANIFEST[PUBLISH_SCHEDULER_IMAGE]}"
  local worker_image_key
  for worker_image_key in "${WORKER_IMAGE_KEYS[@]}"; do
    export "$worker_image_key=${RELEASE_MANIFEST[$worker_image_key]}"
  done
}

declare -gA PUBLISH_SCHEDULER_STATE=()
declare -g PUBLISH_SCHEDULER_RUNTIME_ACTIVE="false"
declare -g PUBLISH_SCHEDULER_RUNTIME_IMAGE="NONE"
declare -g PUBLISH_SCHEDULER_RUNTIME_REVISION="NONE"

write_publish_scheduler_state() {
  local destination="$1"
  local operation="$2"
  local release_sha="$3"
  local target_active="$4"
  local target_image="$5"
  local target_revision="$6"
  local prior_active="$7"
  local prior_image="$8"
  local prior_revision="$9"
  [[ "$operation" == "deploy" || "$operation" == "rollback" ]] || fail "publish_scheduler_transition_invalid"
  require_release_sha "$release_sha"
  for active in "$target_active" "$prior_active"; do
    [[ "$active" == "true" || "$active" == "false" ]] || fail "publish_scheduler_transition_invalid"
  done
  if [[ "$target_active" == "true" ]]; then
    require_digest_image "$target_image"
    require_release_sha "$target_revision"
  else
    [[ "$target_image" == "NONE" && "$target_revision" == "NONE" ]] || fail "publish_scheduler_transition_invalid"
  fi
  if [[ "$prior_active" == "true" ]]; then
    require_digest_image "$prior_image"
    require_release_sha "$prior_revision"
  else
    [[ "$prior_image" == "NONE" && "$prior_revision" == "NONE" ]] || fail "publish_scheduler_transition_invalid"
  fi
  [[ ! -L "$destination" ]] || fail "publish_scheduler_transition_stale"
  atomic_write "$destination" \
    "JOURNAL_SCHEMA=1"$'\n'"OPERATION=$operation"$'\n'"RELEASE_SHA=$release_sha"$'\n'\
"TARGET_ACTIVE=$target_active"$'\n'"TARGET_IMAGE=$target_image"$'\n'"TARGET_REVISION=$target_revision"$'\n'\
"PRIOR_ACTIVE=$prior_active"$'\n'"PRIOR_IMAGE=$prior_image"$'\n'"PRIOR_REVISION=$prior_revision"$'\n' 600
}

parse_publish_scheduler_state() {
  local file="$1"
  local line key value
  local -A allowed=([JOURNAL_SCHEMA]=1 [OPERATION]=1 [RELEASE_SHA]=1 [TARGET_ACTIVE]=1 [TARGET_IMAGE]=1 [TARGET_REVISION]=1 [PRIOR_ACTIVE]=1 [PRIOR_IMAGE]=1 [PRIOR_REVISION]=1)
  require_file_mode_600 "$file" "bpdeploy"
  PUBLISH_SCHEDULER_STATE=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([A-Z_]+)=(.*)$ ]] || fail "publish_scheduler_transition_stale"
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    [[ -v "allowed[$key]" && ! -v "PUBLISH_SCHEDULER_STATE[$key]" ]] || fail "publish_scheduler_transition_stale"
    PUBLISH_SCHEDULER_STATE["$key"]="$value"
  done < "$file"
  [[ "${#PUBLISH_SCHEDULER_STATE[@]}" -eq "${#allowed[@]}" && "${PUBLISH_SCHEDULER_STATE[JOURNAL_SCHEMA]}" == "1" ]] ||
    fail "publish_scheduler_transition_stale"
  [[ "${PUBLISH_SCHEDULER_STATE[OPERATION]}" == "deploy" || "${PUBLISH_SCHEDULER_STATE[OPERATION]}" == "rollback" ]] ||
    fail "publish_scheduler_transition_stale"
  require_release_sha "${PUBLISH_SCHEDULER_STATE[RELEASE_SHA]}"
  for side in TARGET PRIOR; do
    local active="${PUBLISH_SCHEDULER_STATE[${side}_ACTIVE]}"
    [[ "$active" == "true" || "$active" == "false" ]] || fail "publish_scheduler_transition_stale"
    if [[ "$active" == "true" ]]; then
      require_digest_image "${PUBLISH_SCHEDULER_STATE[${side}_IMAGE]}"
      require_release_sha "${PUBLISH_SCHEDULER_STATE[${side}_REVISION]}"
    else
      [[ "${PUBLISH_SCHEDULER_STATE[${side}_IMAGE]}" == "NONE" && "${PUBLISH_SCHEDULER_STATE[${side}_REVISION]}" == "NONE" ]] ||
        fail "publish_scheduler_transition_stale"
    fi
  done
}

inspect_publish_scheduler_runtime() {
  local release_directory="$1"
  local container running image revision container_output
  local -a containers=()
  local -a compose=(docker compose -p brand-pilot -f "$release_directory/compose.production.yml" --env-file "$release_directory/release.env" --profile publish-scheduler)
  container_output="$("${compose[@]}" ps -a -q publish-scheduler-1)" || fail "publish_scheduler_runtime_ambiguous"
  if [[ -n "$container_output" ]]; then
    mapfile -t containers <<< "$container_output"
  fi
  [[ "${#containers[@]}" -le 1 ]] || fail "publish_scheduler_runtime_ambiguous"
  PUBLISH_SCHEDULER_RUNTIME_ACTIVE="false"
  PUBLISH_SCHEDULER_RUNTIME_IMAGE="NONE"
  PUBLISH_SCHEDULER_RUNTIME_REVISION="NONE"
  if [[ "${#containers[@]}" -eq 0 ]]; then return 0; fi
  container="${containers[0]}"
  running="$(docker inspect --format '{{.State.Running}}' "$container")" || fail "publish_scheduler_runtime_ambiguous"
  [[ "$running" == "true" ]] || fail "publish_scheduler_runtime_ambiguous"
  image="$(docker inspect --format '{{.Config.Image}}' "$container")" || fail "publish_scheduler_runtime_ambiguous"
  require_digest_image "$image"
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" ||
    fail "publish_scheduler_runtime_ambiguous"
  require_release_sha "$revision"
  PUBLISH_SCHEDULER_RUNTIME_ACTIVE="true"
  PUBLISH_SCHEDULER_RUNTIME_IMAGE="$image"
  PUBLISH_SCHEDULER_RUNTIME_REVISION="$revision"
}

apply_publish_scheduler_snapshot() {
  local release_directory="$1"
  local ready_timeout_seconds="$2"
  local active="$3"
  local image="$4"
  local revision="$5"
  local actual_revision container_output
  local -a containers=()
  local -a compose=(docker compose -p brand-pilot -f "$release_directory/compose.production.yml" --env-file "$release_directory/release.env" --profile publish-scheduler)
  if [[ "$active" == "true" ]]; then
    require_digest_image "$image"
    require_release_sha "$revision"
    actual_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" ||
      return 1
    [[ "$actual_revision" == "$revision" ]] || return 1
    PUBLISH_SCHEDULER_IMAGE="$image" "${compose[@]}" up -d --no-deps --pull never --force-recreate --wait \
      --wait-timeout "$ready_timeout_seconds" publish-scheduler-1 || return 1
    container_output="$("${compose[@]}" ps -q publish-scheduler-1)" || return 1
    if [[ -n "$container_output" ]]; then
      mapfile -t containers <<< "$container_output"
    fi
    [[ "${#containers[@]}" -eq 1 && -n "${containers[0]}" ]] || return 1
  else
    container_output="$("${compose[@]}" ps -a -q publish-scheduler-1)" || return 1
    if [[ -n "$container_output" ]]; then
      mapfile -t containers <<< "$container_output"
    fi
    if [[ "${#containers[@]}" -gt 0 ]]; then
      "${compose[@]}" stop --timeout 30 publish-scheduler-1 || return 1
      "${compose[@]}" rm -f publish-scheduler-1 || return 1
    fi
    containers=()
    container_output="$("${compose[@]}" ps -a -q publish-scheduler-1)" || return 1
    if [[ -n "$container_output" ]]; then
      mapfile -t containers <<< "$container_output"
    fi
    [[ "${#containers[@]}" -eq 0 ]] || return 1
  fi
}

restore_publish_scheduler_snapshot() {
  local record="$1"
  local release_directory="$2"
  local ready_timeout_seconds="$3"
  parse_publish_scheduler_state "$record"
  apply_publish_scheduler_snapshot "$release_directory" "$ready_timeout_seconds" \
    "${PUBLISH_SCHEDULER_STATE[PRIOR_ACTIVE]}" "${PUBLISH_SCHEDULER_STATE[PRIOR_IMAGE]}" \
    "${PUBLISH_SCHEDULER_STATE[PRIOR_REVISION]}"
}

deploy_publish_scheduler_release() {
  local root="$1" release_directory="$2" ready_timeout_seconds="${3:-120}"
  local current_sha current_api_container running_api_image running_api_revision
  local transition="$root/state/publish-scheduler-transition.journal"
  local previous="$root/state/publish-scheduler-previous"
  [[ ! -e "$transition" && ! -L "$transition" ]] || fail "publish_scheduler_transition_stale"
  load_required_state_sha "$root/state/current" current_sha
  [[ "$(realpath -e -- "$release_directory")" == "$root/releases/$current_sha" ]] || fail "publish_scheduler_release_sha_mismatch"
  validate_release_directory "$release_directory"
  require_worker_image_manifest
  require_publish_scheduler_image_manifest
  [[ "${RELEASE_MANIFEST[RELEASE_SHA]}" == "$current_sha" &&
    "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_SOURCE_SHA]}" == "${RELEASE_MANIFEST[API_SOURCE_SHA]}" ]] ||
    fail "publish_scheduler_release_sha_mismatch"
  export_release_compose_environment
  export PUBLISH_SCHEDULER_ENV_FILE="$root/shared/env/publish-scheduler.env"
  require_publish_scheduler_environment_file "$PUBLISH_SCHEDULER_ENV_FILE"
  export PUBLISH_SCHEDULER_CRON_SECRET_FILE
  PUBLISH_SCHEDULER_CRON_SECRET_FILE="$(require_publish_scheduler_secret "$root" "${RELEASE_MANIFEST[API_ENV_FILE]}")"
  local -a compose=(docker compose -p brand-pilot -f "$release_directory/compose.production.yml" --env-file "$release_directory/release.env" --profile publish-scheduler)
  "${compose[@]}" config --quiet >/dev/null
  current_api_container="$("${compose[@]}" ps -q api-primary)"
  [[ -n "$current_api_container" && "$current_api_container" != *$'\n'* ]] || fail "publish_scheduler_primary_container_invalid"
  running_api_image="$(docker inspect --format '{{.Config.Image}}' "$current_api_container")" || fail "publish_scheduler_primary_container_invalid"
  [[ "$running_api_image" == "${RELEASE_MANIFEST[API_IMAGE]}" ]] || fail "publish_scheduler_primary_image_mismatch"
  running_api_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$running_api_image")" ||
    fail "publish_scheduler_primary_image_mismatch"
  [[ "$running_api_revision" == "${RELEASE_MANIFEST[API_SOURCE_SHA]}" ]] || fail "publish_scheduler_primary_image_mismatch"
  inspect_publish_scheduler_runtime "$release_directory"
  "${compose[@]}" pull publish-scheduler-1
  validate_publish_scheduler_against_primary "$current_sha"
  write_publish_scheduler_state "$transition" deploy "$current_sha" true \
    "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_IMAGE]}" "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_SOURCE_SHA]}" \
    "$PUBLISH_SCHEDULER_RUNTIME_ACTIVE" "$PUBLISH_SCHEDULER_RUNTIME_IMAGE" "$PUBLISH_SCHEDULER_RUNTIME_REVISION"
  publish_scheduler_deploy_recover() {
    local exit_code="$?"
    trap - EXIT
    if [[ "$exit_code" -ne 0 ]]; then
      restore_publish_scheduler_snapshot "$transition" "$release_directory" "$ready_timeout_seconds" || exit 70
      remove_state_file "$transition"
    fi
    exit "$exit_code"
  }
  trap publish_scheduler_deploy_recover EXIT
  apply_publish_scheduler_snapshot "$release_directory" "$ready_timeout_seconds" true \
    "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_IMAGE]}" "${RELEASE_MANIFEST[PUBLISH_SCHEDULER_SOURCE_SHA]}"
  parse_publish_scheduler_state "$transition"
  write_publish_scheduler_state "$previous" deploy "$current_sha" \
    "${PUBLISH_SCHEDULER_STATE[TARGET_ACTIVE]}" "${PUBLISH_SCHEDULER_STATE[TARGET_IMAGE]}" "${PUBLISH_SCHEDULER_STATE[TARGET_REVISION]}" \
    "${PUBLISH_SCHEDULER_STATE[PRIOR_ACTIVE]}" "${PUBLISH_SCHEDULER_STATE[PRIOR_IMAGE]}" "${PUBLISH_SCHEDULER_STATE[PRIOR_REVISION]}"
  remove_state_file "$transition"
  trap - EXIT
}

rollback_publish_scheduler_release() {
  local root="$1" release_directory="$2" ready_timeout_seconds="${3:-120}"
  local current_sha
  local transition="$root/state/publish-scheduler-transition.journal"
  local previous="$root/state/publish-scheduler-previous"
  [[ ! -e "$transition" && ! -L "$transition" ]] || fail "publish_scheduler_transition_stale"
  load_required_state_sha "$root/state/current" current_sha
  validate_release_directory "$release_directory"
  export_release_compose_environment
  export PUBLISH_SCHEDULER_ENV_FILE="$root/shared/env/publish-scheduler.env"
  require_publish_scheduler_environment_file "$PUBLISH_SCHEDULER_ENV_FILE"
  export PUBLISH_SCHEDULER_CRON_SECRET_FILE="$root/shared/secrets/cron-secret"
  parse_publish_scheduler_state "$previous"
  [[ "${PUBLISH_SCHEDULER_STATE[RELEASE_SHA]}" == "$current_sha" ]] || fail "publish_scheduler_transition_stale"
  local target_active="${PUBLISH_SCHEDULER_STATE[PRIOR_ACTIVE]}"
  local target_image="${PUBLISH_SCHEDULER_STATE[PRIOR_IMAGE]}"
  local target_revision="${PUBLISH_SCHEDULER_STATE[PRIOR_REVISION]}"
  local expected_active="${PUBLISH_SCHEDULER_STATE[TARGET_ACTIVE]}"
  local expected_image="${PUBLISH_SCHEDULER_STATE[TARGET_IMAGE]}"
  local expected_revision="${PUBLISH_SCHEDULER_STATE[TARGET_REVISION]}"
  inspect_publish_scheduler_runtime "$release_directory"
  [[ "$PUBLISH_SCHEDULER_RUNTIME_ACTIVE" == "$expected_active" &&
    "$PUBLISH_SCHEDULER_RUNTIME_IMAGE" == "$expected_image" &&
    "$PUBLISH_SCHEDULER_RUNTIME_REVISION" == "$expected_revision" ]] || fail "publish_scheduler_transition_stale"
  write_publish_scheduler_state "$transition" rollback "$current_sha" "$target_active" "$target_image" "$target_revision" \
    "$PUBLISH_SCHEDULER_RUNTIME_ACTIVE" "$PUBLISH_SCHEDULER_RUNTIME_IMAGE" "$PUBLISH_SCHEDULER_RUNTIME_REVISION"
  publish_scheduler_rollback_recover() {
    local exit_code="$?"
    trap - EXIT
    if [[ "$exit_code" -ne 0 ]]; then
      restore_publish_scheduler_snapshot "$transition" "$release_directory" "$ready_timeout_seconds" || exit 70
      remove_state_file "$transition"
    fi
    exit "$exit_code"
  }
  trap publish_scheduler_rollback_recover EXIT
  apply_publish_scheduler_snapshot "$release_directory" "$ready_timeout_seconds" "$target_active" "$target_image" "$target_revision"
  remove_state_file "$transition"
  remove_state_file "$previous"
  trap - EXIT
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
    allowed_keys[PUBLISH_SCHEDULER_IMAGE]=1
    allowed_keys[PUBLISH_SCHEDULER_SOURCE_SHA]=1
    allowed_keys[PUBLISH_SCHEDULER_CHANGED]=1
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
  MARKETING_RETIREMENT_BASELINE_MANIFEST_SHA256=""
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
    if [[ -v "RELEASE_MANIFEST[PUBLISH_SCHEDULER_IMAGE]" ||
      -v "RELEASE_MANIFEST[PUBLISH_SCHEDULER_SOURCE_SHA]" ||
      -v "RELEASE_MANIFEST[PUBLISH_SCHEDULER_CHANGED]" ]]; then
      require_publish_scheduler_image_manifest
    fi
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

validate_normal_rollback_target() {
  local root="$1"
  local release_sha="$2"
  local release_directory="$root/releases/$release_sha"
  local manifest="$release_directory/release.env"
  require_release_sha "$release_sha"
  if [[ -f "$manifest" ]] && grep -Eq '^RELEASE_SCHEMA=[12]$' "$manifest"; then
    fail "legacy_release_rollback_forbidden"
  fi
  validate_release_directory "$release_directory" candidate
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
      "755 scripts/restore-state.sh" \
      "755 scripts/ai-content-cutover.sh" \
      "755 scripts/verify-ai-content-cutover.sh" \
      "755 scripts/stage-ai-content-release.sh" \
      "755 scripts/preflight-ai-content.sh" \
      "755 scripts/rollout-ai-content-cutover.sh" \
      "755 scripts/collect-ai-content-backend-evidence.sh"
  else
    local optional_path
    for optional_path in scripts/rollout-workers.sh scripts/backup-state.sh scripts/restore-state.sh \
      scripts/ai-content-cutover.sh scripts/verify-ai-content-cutover.sh \
      scripts/stage-ai-content-release.sh scripts/preflight-ai-content.sh \
      scripts/rollout-ai-content-cutover.sh scripts/collect-ai-content-backend-evidence.sh; do
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

require_secure_state_directory() {
  local path="$1"
  [[ -d "$path" && ! -L "$path" ]] || fail "state_directory_invalid"
  [[ "$(stat -c '%a' -- "$path")" == "700" ]] || fail "state_directory_mode_invalid"
  [[ "$(stat -c '%U' -- "$path")" == "bpdeploy" ]] || fail "state_directory_owner_invalid"
}

resolve_ai_content_floor_probe_image() {
  local root="$1"
  local script_release_directory
  local state_file
  local release_sha=""
  local -a state_files=("$root/state/candidate" "$root/state/current")

  script_release_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ -f "$script_release_directory/release.env" ]]; then
    validate_release_directory "$script_release_directory" candidate
    verify_release_image_revision \
      "${RELEASE_MANIFEST[API_IMAGE]}" "$(release_image_source_revision API_IMAGE)"
    printf '%s\n' "${RELEASE_MANIFEST[API_IMAGE]}"
    return 0
  fi

  for state_file in "${state_files[@]}"; do
    if load_optional_state_sha "$state_file" release_sha; then
      validate_state_release_directory "$root" "$release_sha"
      verify_release_image_revision \
        "${RELEASE_MANIFEST[API_IMAGE]}" "$(release_image_source_revision API_IMAGE)"
      printf '%s\n' "${RELEASE_MANIFEST[API_IMAGE]}"
      return 0
    fi
  done
  return 1
}

resolve_ai_content_floor_database_input() {
  local root="$1"
  local output_file_variable="$2"
  local output_kind_variable="$3"
  local owner="${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
  local operator_file="${AI_CONTENT_CUTOVER_OPERATOR_DATABASE_URL_FILE:-$root/shared/secrets/ai-content-operator-database-url}"
  local api_env_file="$root/shared/env/api.env"

  if [[ -e "$operator_file" || -L "$operator_file" ]]; then
    require_file_mode_600 "$operator_file" "$owner"
    printf -v "$output_file_variable" '%s' "$operator_file"
    printf -v "$output_kind_variable" '%s' "operator"
    return 0
  fi
  require_file_mode_600 "$api_env_file" "$owner"
  printf -v "$output_file_variable" '%s' "$api_env_file"
  printf -v "$output_kind_variable" '%s' "env"
}

resolve_ai_content_floor_tls_environment() {
  local root="$1"
  local owner="${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
  local env_file="$root/shared/env/api.env"
  local line ca_line="" ca_count=0
  require_file_mode_600 "$env_file" "$owner"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == DB_SSL_CA_BASE64=* ]]; then
      ca_count="$((ca_count + 1))"
      [[ "$line" =~ ^DB_SSL_CA_BASE64=[A-Za-z0-9+/]+={0,2}$ ]] ||
        fail "ai_content_database_ca_invalid"
      ca_line="$line"
    fi
  done < "$env_file"
  [[ "$ca_count" == "1" ]] || fail "ai_content_database_ca_invalid"
  printf '%s\0' --env "$ca_line"
}

probe_ai_content_075_marker() {
  local root="$1"
  local database_input=""
  local database_input_kind=""
  local api_image
  local output
  local -a tls_environment=()
  require_command docker
  require_command id
  resolve_ai_content_floor_database_input \
    "$root" database_input database_input_kind
  mapfile -d '' -t tls_environment < <(resolve_ai_content_floor_tls_environment "$root")
  api_image="$(resolve_ai_content_floor_probe_image "$root")" || return 1
  if ! output="$(docker run --rm --pull never --read-only \
    --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m "${tls_environment[@]}" --entrypoint node \
    --mount "type=bind,src=$database_input,dst=/run/secrets/ai-content-floor-database-input,readonly" \
    "$api_image" /app/scripts/ai-content-cutover-floor-probe.mjs \
    --input-file /run/secrets/ai-content-floor-database-input \
    --input-kind "$database_input_kind")"; then
    return 1
  fi
  [[ "$output" == "true" || "$output" == "false" ]] || return 1
  printf '%s\n' "$output"
}

ai_content_cutover_marker_present() {
  local marker
  if ! marker="$(probe_ai_content_075_marker "$1")"; then
    return 2
  fi
  [[ "$marker" == "true" ]] && return 0
  [[ "$marker" == "false" ]] && return 1
  return 2
}

declare -g AI_CONTENT_COMPLETED_EVIDENCE_FILE=""

find_ai_content_completed_evidence() {
  local root="$1"
  local base="$root/state/ai-content-cutovers"
  local nullglob_was_set=false
  local -a evidence_files=()
  AI_CONTENT_COMPLETED_EVIDENCE_FILE=""
  if [[ ! -e "$base" && ! -L "$base" ]]; then
    return 1
  fi
  require_secure_state_directory "$base"
  if shopt -q nullglob; then
    nullglob_was_set=true
  fi
  shopt -s nullglob
  evidence_files=("$base"/*/finalize-post-075/completed/evidence.json)
  if [[ "$nullglob_was_set" == "false" ]]; then
    shopt -u nullglob
  fi
  [[ "${#evidence_files[@]}" -le 1 ]] || fail "ai_content_cutover_completed_evidence_ambiguous"
  [[ "${#evidence_files[@]}" -eq 1 ]] || return 1
  AI_CONTENT_COMPLETED_EVIDENCE_FILE="${evidence_files[0]}"
}

query_ai_content_cutover_status() {
  local root="$1"
  local cutover_id="$2"
  local operator_database_file="${AI_CONTENT_CUTOVER_OPERATOR_DATABASE_URL_FILE:-$root/shared/secrets/ai-content-operator-database-url}"
  local current_sha=""
  local api_image
  local output
  local -a tls_environment=()
  require_command docker
  require_command id
  require_file_mode_600 "$operator_database_file" "${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
  load_required_state_sha "$root/state/current" current_sha
  validate_state_release_directory "$root" "$current_sha"
  api_image="${RELEASE_MANIFEST[API_IMAGE]}"
  verify_release_image_revision "$api_image" "$(release_image_source_revision API_IMAGE)"
  mapfile -d '' -t tls_environment < <(resolve_ai_content_floor_tls_environment "$root")
  if ! output="$(docker run --rm --pull never --read-only \
    --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m "${tls_environment[@]}" --entrypoint node \
    --mount "type=bind,src=$operator_database_file,dst=/run/secrets/operator-database-url,readonly" \
    "$api_image" /app/scripts/ai-content-cutover-control.mjs --status \
    --database-url-file /run/secrets/operator-database-url --cutover-id "$cutover_id")"; then
    return 1
  fi
  [[ -n "$output" && "$output" != *$'\n'* ]] || return 1
  printf '%s\n' "$output"
}

validate_ai_content_completed_floor() {
  local root="$1"
  local evidence_file
  local completed_directory
  local finalize_directory
  local cutover_directory
  local cutover_id
  local evidence_line
  local evidence_timestamp
  local evidence_cleanup_sha
  local current_sha=""
  local database_status
  local database_timestamp
  local database_cleanup_sha
  local evidence_pattern
  local database_pattern

  find_ai_content_completed_evidence "$root" || return 1
  evidence_file="$AI_CONTENT_COMPLETED_EVIDENCE_FILE"
  completed_directory="$(dirname -- "$evidence_file")"
  finalize_directory="$(dirname -- "$completed_directory")"
  cutover_directory="$(dirname -- "$finalize_directory")"
  cutover_id="$(basename -- "$cutover_directory")"
  [[ "$cutover_id" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] ||
    fail "ai_content_cutover_completed_evidence_invalid"
  require_secure_state_directory "$cutover_directory"
  require_secure_state_directory "$finalize_directory"
  require_secure_state_directory "$completed_directory"
  require_secure_state_file "$evidence_file"
  evidence_line="$(<"$evidence_file")"
  [[ -n "$evidence_line" && "$evidence_line" != *$'\n'* && "$evidence_line" != *$'\r'* ]] ||
    fail "ai_content_cutover_completed_evidence_invalid"
  evidence_pattern='^\{"cleanupCredentialRevokedAt":"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z)","cleanupRevocationEvidenceSha256":"([a-f0-9]{64})","cutoverId":"([a-f0-9-]{36})","eventSha256":"[a-f0-9]{64}","evidenceSha256":"[a-f0-9]{64}","maintenanceEnabled":false,"markerPresent":true,"status":"completed"\}$'
  [[ "$evidence_line" =~ $evidence_pattern ]] || fail "ai_content_cutover_completed_evidence_invalid"
  evidence_timestamp="${BASH_REMATCH[1]}"
  evidence_cleanup_sha="${BASH_REMATCH[2]}"
  [[ "${BASH_REMATCH[3]}" == "$cutover_id" ]] || fail "ai_content_cutover_completed_evidence_invalid"

  load_required_state_sha "$root/state/current" current_sha
  validate_state_release_directory "$root" "$current_sha"
  [[ "${RELEASE_MANIFEST[RELEASE_SCHEMA]}" == "3" ]] ||
    fail "ai_content_cutover_completed_current_schema_invalid"

  if ! database_status="$(query_ai_content_cutover_status "$root" "$cutover_id")"; then
    fail "ai_content_cutover_floor_query_failed"
  fi
  database_pattern='^\{"activeCutoverCount":0,"activeCutoverId":null,"cleanupCredentialRevokedAt":"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z)","cleanupRevocationEvidenceSha256":"([a-f0-9]{64})","cutoverId":"([a-f0-9-]{36})","maintenanceCutoverId":null,"maintenanceEnabled":false,"markerPresent":true,"status":"completed"\}$'
  [[ "$database_status" =~ $database_pattern ]] ||
    fail "ai_content_cutover_completed_database_status_invalid"
  database_timestamp="${BASH_REMATCH[1]}"
  database_cleanup_sha="${BASH_REMATCH[2]}"
  [[ "${BASH_REMATCH[3]}" == "$cutover_id" &&
    "$database_timestamp" == "$evidence_timestamp" &&
    "$database_cleanup_sha" == "$evidence_cleanup_sha" ]] ||
    fail "ai_content_cutover_completed_database_status_invalid"
}

enforce_ai_content_roll_forward_floor() {
  local root="$1"
  local active_file="$root/state/ai-content-cutover-id"
  local marker_status
  local active_cutover_id=""

  if ai_content_cutover_marker_present "$root"; then
    marker_status=0
  else
    marker_status="$?"
  fi
  [[ "$marker_status" -eq 0 || "$marker_status" -eq 1 ]] ||
    fail "ai_content_cutover_floor_query_failed"

  if [[ -e "$active_file" || -L "$active_file" ]]; then
    require_secure_state_file "$active_file"
    active_cutover_id="$(<"$active_file")"
    [[ "$active_cutover_id" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] ||
      fail "ai_content_cutover_active_id_invalid"
  fi

  if [[ "$marker_status" -eq 0 && -n "$active_cutover_id" ]]; then
    fail "ai_content_cutover_roll_forward_only"
  fi
  if [[ "$marker_status" -eq 1 && -n "$active_cutover_id" ]]; then
    fail "ai_content_cutover_abort_pre_marker_required"
  fi
  if [[ "$marker_status" -eq 1 ]]; then
    if find_ai_content_completed_evidence "$root"; then
      fail "ai_content_cutover_marker_status_invalid"
    fi
    return 0
  fi
  if validate_ai_content_completed_floor "$root"; then
    return 0
  fi
  fail "ai_content_cutover_completed_evidence_required"
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
  enforce_ai_content_roll_forward_floor "$1"
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
