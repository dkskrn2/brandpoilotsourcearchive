#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
FILE_OWNER="${AI_CONTENT_CUTOVER_FILE_OWNER:-bpdeploy}"
MODE="${1:-}"
[[ -n "$MODE" ]] || fail "ai_content_cutover_mode_required"
shift || true

declare -A OPTION=()
while [[ $# -gt 0 ]]; do
  [[ "$1" == --* && $# -ge 2 ]] || fail "ai_content_cutover_arguments_invalid"
  key="${1#--}"
  [[ "$key" =~ ^[a-z0-9-]+$ && ! -v "OPTION[$key]" ]] || fail "ai_content_cutover_arguments_invalid"
  OPTION["$key"]="$2"
  shift 2
done

option() {
  local key="$1"
  [[ -v "OPTION[$key]" && -n "${OPTION[$key]}" ]] || fail "ai_content_cutover_argument_missing"
  printf '%s' "${OPTION[$key]}"
}

require_uuid() {
  [[ "$1" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] ||
    fail "ai_content_cutover_id_invalid"
}

require_hex() {
  local value="$1"
  local length="$2"
  [[ "$value" =~ ^[a-f0-9]+$ && "${#value}" -eq "$length" ]] || fail "ai_content_cutover_hash_invalid"
}

require_secure_input() {
  local file="$1"
  [[ "$file" =~ ^/[a-zA-Z0-9._/-]+$ ]] || fail "ai_content_cutover_input_path_invalid"
  require_file_mode_600 "$file" "$FILE_OWNER"
}

capture_evidence() {
  local output_file="$1"
  shift
  local output
  [[ "$output_file" =~ ^/[a-zA-Z0-9._/-]+$ ]] || fail "ai_content_cutover_output_path_invalid"
  [[ ! -e "$output_file" && ! -L "$output_file" ]] || fail "ai_content_cutover_evidence_exists"
  [[ -d "$(dirname -- "$output_file")" ]] || fail "ai_content_cutover_output_directory_missing"
  output="$("$@")" || fail "ai_content_cutover_command_failed"
  [[ -n "$output" ]] || fail "ai_content_cutover_evidence_empty"
  atomic_write "$output_file" "${output}"$'\n' 600
}

RELEASE_SHA=""
RELEASE_DIR=""
API_IMAGE=""
API_SOURCE_SHA=""
load_release_directory() {
  RELEASE_SHA="$(option release)"
  require_release_sha "$RELEASE_SHA"
  RELEASE_DIR="$ROOT/releases/$RELEASE_SHA"
  validate_release_directory "$RELEASE_DIR"
  API_IMAGE="${RELEASE_MANIFEST[API_IMAGE]}"
  API_SOURCE_SHA="$(release_image_source_revision API_IMAGE)"
  require_digest_image "$API_IMAGE"
  verify_release_image_revision "$API_IMAGE" "$API_SOURCE_SHA"
  [[ "$(docker image inspect --format '{{.Config.User}}' "$API_IMAGE")" == "node" ]] ||
    fail "ai_content_cutover_api_image_user_invalid"
}

require_staged_release_pointer_consistency() {
  local staged_sha=""
  if load_optional_state_sha "$ROOT/state/ai-content-staged-release" staged_sha; then
    [[ "$staged_sha" == "$RELEASE_SHA" ]] ||
      fail "ai_content_cutover_staged_release_mismatch"
  fi
}

load_staged_release() {
  local staged_sha="" candidate_sha=""
  RELEASE_SHA="$(option release)"
  require_release_sha "$RELEASE_SHA"
  load_required_state_sha "$ROOT/state/ai-content-staged-release" staged_sha
  [[ "$staged_sha" == "$RELEASE_SHA" ]] ||
    fail "ai_content_cutover_staged_release_mismatch"
  if load_optional_state_sha "$ROOT/state/candidate" candidate_sha; then
    [[ "$candidate_sha" == "$RELEASE_SHA" ]] ||
      fail "ai_content_cutover_candidate_mismatch"
  fi
  load_release_directory
}

remove_staged_release_pointer() {
  local staged_sha=""
  if load_optional_state_sha "$ROOT/state/ai-content-staged-release" staged_sha; then
    [[ "$staged_sha" == "$RELEASE_SHA" ]] ||
      fail "ai_content_cutover_staged_release_mismatch"
    remove_state_file "$ROOT/state/ai-content-staged-release"
  fi
}

load_runtime_release() {
  local candidate_sha="" current_sha=""
  local candidate_matches=false current_matches=false
  RELEASE_SHA="$(option release)"
  require_release_sha "$RELEASE_SHA"
  if load_optional_state_sha "$ROOT/state/candidate" candidate_sha; then
    [[ "$candidate_sha" == "$RELEASE_SHA" ]] ||
      fail "ai_content_cutover_candidate_mismatch"
    candidate_matches=true
  fi
  if load_optional_state_sha "$ROOT/state/current" current_sha; then
    if [[ "$current_sha" == "$RELEASE_SHA" ]]; then
      current_matches=true
    elif [[ "$candidate_matches" != "true" ]]; then
      fail "ai_content_cutover_current_mismatch"
    fi
  fi
  [[ "$candidate_matches" == "true" || "$current_matches" == "true" ]] ||
    fail "ai_content_cutover_runtime_release_missing"
  load_release_directory
  require_staged_release_pointer_consistency
}

database_tls_environment() {
  local env_file="$ROOT/shared/env/api.env"
  local ca_line ca_count
  require_file_mode_600 "$env_file" "$FILE_OWNER"
  ca_count="$(grep -Ec '^DB_SSL_CA_BASE64=[A-Za-z0-9+/]+={0,2}$' "$env_file" || true)"
  [[ "$ca_count" == "1" ]] || fail "ai_content_database_ca_invalid"
  ca_line="$(grep -E '^DB_SSL_CA_BASE64=[A-Za-z0-9+/]+={0,2}$' "$env_file")"
  printf '%s\0' --env "$ca_line"
}

docker_runtime_prefix() {
  local -a database_tls_env=()
  mapfile -d '' -t database_tls_env < <(database_tls_environment)
  printf '%s\0' docker run --rm --read-only \
    --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m "${database_tls_env[@]}" --entrypoint node
}

declare -a RUNTIME=()
load_runtime() {
  mapfile -d '' -t RUNTIME < <(docker_runtime_prefix)
}

role_environment() {
  printf '%s\0' \
    --env AI_CONTENT_074_SCHEMA_OWNER_ROLE=content_schema_owner \
    --env AI_CONTENT_074_APPLICATION_ROLE=content_application \
    --env AI_CONTENT_074_OPERATOR_ROLE=content_operator \
    --env AI_CONTENT_074_MIGRATION_ROLE=content_migration \
    --env AI_CONTENT_074_CLEANUP_ROLE=content_cleanup
}

declare -a ROLE_ENV=()
load_role_environment() {
  mapfile -d '' -t ROLE_ENV < <(role_environment)
}

bootstrap_public_environment() {
  local authorization_key_id="$1"
  local authorization_key_sha256="$2"
  local provider_key_id="$3"
  local provider_key_sha256="$4"
  printf '%s\0' \
    --env AI_CONTENT_074_AUTHORIZATION_FILE=/run/secrets/authorization.json \
    --env AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_FILE=/run/secrets/authorization-public.pem \
    --env "AI_CONTENT_074_AUTHORIZATION_KEY_ID=$authorization_key_id" \
    --env "AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256=$authorization_key_sha256" \
    --env AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE=/run/secrets/provider-public.pem \
    --env "AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_ID=$provider_key_id" \
    --env "AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256=$provider_key_sha256" \
    --env "AI_CONTENT_F_API_IMAGE_DIGEST=${API_IMAGE##*@}" \
    --env "AI_CONTENT_F_API_SOURCE_LABEL=$API_SOURCE_SHA"
}

mount_readonly() {
  local source_file="$1"
  local target_file="$2"
  printf '%s\0' --mount "type=bind,src=$source_file,dst=$target_file,readonly"
}

require_pre_marker_inactive_phase() {
  enforce_ai_content_roll_forward_floor "$ROOT"
}

PROVIDER_ARTIFACT_DIRECTORY=""
AUTHORIZATION_PRIVATE_KEY_FILE=""
AUTHORIZATION_PUBLIC_KEY_FILE=""
PROVIDER_PRIVATE_KEY_FILE=""
PROVIDER_PUBLIC_KEY_FILE=""
BYPASS_TOKEN_FILE=""
CLEANUP_TOKEN_FILE=""
PROVIDER_IDENTITY_FILE=""
AUTHORIZATION_KEY_ID=""
PROVIDER_KEY_ID=""
AUTHORIZATION_KEY_SHA256=""
PROVIDER_KEY_SHA256=""

provider_artifact_directory() {
  printf '%s' "$ROOT/state/ai-content-cutovers/$1/provider-artifacts"
}

require_artifact_directory() {
  local directory="$1"
  [[ -d "$directory" && ! -L "$directory" ]] || fail "ai_content_provider_artifact_directory_invalid"
  [[ "$(stat -c '%a' -- "$directory")" == "700" ]] || fail "ai_content_provider_artifact_directory_invalid"
  [[ "$(stat -c '%U' -- "$directory")" == "$FILE_OWNER" ]] || fail "ai_content_provider_artifact_directory_invalid"
}

remove_provider_temporary_directory() {
  local directory="$1"
  local parent="$2"
  local prefix="$3"
  local resolved_directory resolved_parent base_name
  [[ "$prefix" =~ ^[a-z0-9-]+$ && -d "$parent" && ! -L "$parent" \
    && -d "$directory" && ! -L "$directory" ]] ||
    fail "ai_content_provider_artifact_cleanup_target_invalid"
  resolved_parent="$(readlink -f -- "$parent")"
  resolved_directory="$(readlink -f -- "$directory")"
  base_name="${resolved_directory##*/}"
  [[ "$resolved_directory" == "$resolved_parent"/.* \
    && "$base_name" =~ ^\.${prefix}\.[A-Za-z0-9]{6}$ ]] ||
    fail "ai_content_provider_artifact_cleanup_target_invalid"
  rm -rf -- "$resolved_directory"
}

load_provider_artifacts() {
  local cutover_id="$1"
  local identity_line identity_body identity_sha256 expected_identity authorization_hash provider_hash
  require_uuid "$cutover_id"
  PROVIDER_ARTIFACT_DIRECTORY="$(provider_artifact_directory "$cutover_id")"
  require_artifact_directory "$PROVIDER_ARTIFACT_DIRECTORY"
  AUTHORIZATION_PRIVATE_KEY_FILE="$PROVIDER_ARTIFACT_DIRECTORY/authorization-private.pem"
  AUTHORIZATION_PUBLIC_KEY_FILE="$PROVIDER_ARTIFACT_DIRECTORY/authorization-public.pem"
  PROVIDER_PRIVATE_KEY_FILE="$PROVIDER_ARTIFACT_DIRECTORY/provider-private.pem"
  PROVIDER_PUBLIC_KEY_FILE="$PROVIDER_ARTIFACT_DIRECTORY/provider-public.pem"
  BYPASS_TOKEN_FILE="$PROVIDER_ARTIFACT_DIRECTORY/bypass-token"
  CLEANUP_TOKEN_FILE="$PROVIDER_ARTIFACT_DIRECTORY/cleanup-token"
  PROVIDER_IDENTITY_FILE="$PROVIDER_ARTIFACT_DIRECTORY/identity.json"
  local artifact
  for artifact in "$AUTHORIZATION_PRIVATE_KEY_FILE" "$AUTHORIZATION_PUBLIC_KEY_FILE" \
    "$PROVIDER_PRIVATE_KEY_FILE" "$PROVIDER_PUBLIC_KEY_FILE" "$BYPASS_TOKEN_FILE" \
    "$CLEANUP_TOKEN_FILE" "$PROVIDER_IDENTITY_FILE"; do
    require_file_mode_600 "$artifact" "$FILE_OWNER"
  done
  [[ "$(wc -c < "$BYPASS_TOKEN_FILE")" == "64" ]] && grep -Eq '^[a-f0-9]{64}$' "$BYPASS_TOKEN_FILE" ||
    fail "ai_content_cutover_token_invalid"
  [[ "$(wc -c < "$CLEANUP_TOKEN_FILE")" == "64" ]] && grep -Eq '^[a-f0-9]{64}$' "$CLEANUP_TOKEN_FILE" ||
    fail "ai_content_cutover_token_invalid"
  AUTHORIZATION_KEY_ID="ai-content-authorization-$cutover_id"
  PROVIDER_KEY_ID="ai-content-provider-$cutover_id"
  identity_line="$(<"$PROVIDER_IDENTITY_FILE")"
  authorization_hash="$(sed -nE 's/^.*"authorizationPublicKeySha256":"([a-f0-9]{64})".*$/\1/p' <<<"$identity_line")"
  provider_hash="$(sed -nE 's/^.*"providerPublicKeySha256":"([a-f0-9]{64})".*$/\1/p' <<<"$identity_line")"
  require_hex "$authorization_hash" 64
  require_hex "$provider_hash" 64
  identity_body="{\"contractVersion\":\"ai-content-cutover-provider-artifacts.v1\",\"cutoverId\":\"$cutover_id\",\"authorizationKeyId\":\"$AUTHORIZATION_KEY_ID\",\"authorizationPublicKeySha256\":\"$authorization_hash\",\"providerKeyId\":\"$PROVIDER_KEY_ID\",\"providerPublicKeySha256\":\"$provider_hash\"}"
  identity_sha256="$(printf '%s' "$identity_body" | sha256sum)"
  identity_sha256="${identity_sha256%% *}"
  expected_identity="${identity_body%\}},\"identitySha256\":\"$identity_sha256\"}"
  [[ "$identity_line" == "$expected_identity" ]] || fail "ai_content_provider_artifact_identity_invalid"
  AUTHORIZATION_KEY_SHA256="$authorization_hash"
  PROVIDER_KEY_SHA256="$provider_hash"
}

run_initialize_provider_artifacts() {
  load_staged_release
  require_pre_marker_inactive_phase
  require_command openssl
  require_command mv
  require_command wc
  local cutover_id output_file state_parent artifact_directory temporary_directory
  local authorization_hash provider_hash identity_body identity_sha256
  local bypass_token cleanup_token
  cutover_id="$(option cutover-id)"
  output_file="$(option output)"
  require_uuid "$cutover_id"
  state_parent="$ROOT/state/ai-content-cutovers/$cutover_id"
  artifact_directory="$(provider_artifact_directory "$cutover_id")"
  install -d -m 0700 "$ROOT/state/ai-content-cutovers" "$state_parent"
  require_artifact_directory "$ROOT/state/ai-content-cutovers"
  require_artifact_directory "$state_parent"
  if [[ ! -e "$artifact_directory" && ! -L "$artifact_directory" ]]; then
    temporary_directory="$(mktemp -d "$state_parent/.provider-artifacts.XXXXXX")"
    chmod 0700 "$temporary_directory"
    cleanup_provider_artifact_temporary() {
      [[ -z "$temporary_directory" ]] ||
        remove_provider_temporary_directory "$temporary_directory" "$state_parent" provider-artifacts
    }
    trap cleanup_provider_artifact_temporary EXIT
    umask 077
    openssl genpkey -algorithm ED25519 -out "$temporary_directory/authorization-private.pem" >/dev/null 2>&1 ||
      fail "ai_content_authorization_key_generation_failed"
    openssl pkey -in "$temporary_directory/authorization-private.pem" -pubout \
      -out "$temporary_directory/authorization-public.pem" >/dev/null 2>&1 ||
      fail "ai_content_authorization_key_generation_failed"
    openssl genpkey -algorithm ED25519 -out "$temporary_directory/provider-private.pem" >/dev/null 2>&1 ||
      fail "ai_content_provider_key_generation_failed"
    openssl pkey -in "$temporary_directory/provider-private.pem" -pubout \
      -out "$temporary_directory/provider-public.pem" >/dev/null 2>&1 ||
      fail "ai_content_provider_key_generation_failed"
    [[ "$(openssl pkey -pubin -in "$temporary_directory/authorization-public.pem" -outform DER | wc -c)" == "44" \
      && "$(openssl pkey -pubin -in "$temporary_directory/provider-public.pem" -outform DER | wc -c)" == "44" ]] ||
      fail "ai_content_provider_artifact_key_algorithm_invalid"
    authorization_hash="$(openssl pkey -pubin -in "$temporary_directory/authorization-public.pem" -outform DER | sha256sum)"
    authorization_hash="${authorization_hash%% *}"
    provider_hash="$(openssl pkey -pubin -in "$temporary_directory/provider-public.pem" -outform DER | sha256sum)"
    provider_hash="${provider_hash%% *}"
    require_hex "$authorization_hash" 64
    require_hex "$provider_hash" 64
    bypass_token="$(openssl rand -hex 32)"
    cleanup_token="$(openssl rand -hex 32)"
    [[ "$bypass_token" =~ ^[a-f0-9]{64}$ && "$cleanup_token" =~ ^[a-f0-9]{64}$ ]] ||
      fail "ai_content_cutover_token_generation_failed"
    atomic_write "$temporary_directory/bypass-token" "$bypass_token" 600
    atomic_write "$temporary_directory/cleanup-token" "$cleanup_token" 600
    identity_body="{\"contractVersion\":\"ai-content-cutover-provider-artifacts.v1\",\"cutoverId\":\"$cutover_id\",\"authorizationKeyId\":\"ai-content-authorization-$cutover_id\",\"authorizationPublicKeySha256\":\"$authorization_hash\",\"providerKeyId\":\"ai-content-provider-$cutover_id\",\"providerPublicKeySha256\":\"$provider_hash\"}"
    identity_sha256="$(printf '%s' "$identity_body" | sha256sum)"
    identity_sha256="${identity_sha256%% *}"
    atomic_write "$temporary_directory/identity.json" \
      "${identity_body%\}},\"identitySha256\":\"$identity_sha256\"}"$'\n' 600
    chmod 0600 "$temporary_directory"/*
    sync -f -- "$temporary_directory"
    mv -- "$temporary_directory" "$artifact_directory"
    temporary_directory=""
    sync -f -- "$state_parent"
    trap - EXIT
  fi
  load_provider_artifacts "$cutover_id"
  copy_durable_evidence "$PROVIDER_IDENTITY_FILE" "$output_file" \
    "ai_content_provider_artifact_identity_output_mismatch"
}

run_verify_and_authorize_074() {
  load_runtime_release
  require_pre_marker_inactive_phase
  load_runtime
  local cutover_id migration_file plan_file verification_output authorization_output state_directory temporary_directory
  local verification_file authorization_file
  local -a migration_mount=() plan_mount=()
  cutover_id="$(option cutover-id)"
  migration_file="$(option migration-url-file)"
  plan_file="$(option plan-file)"
  verification_output="$(option verification-output)"
  authorization_output="$(option authorization-output)"
  require_uuid "$cutover_id"
  require_secure_input "$migration_file"
  require_secure_input "$plan_file"
  load_provider_artifacts "$cutover_id"
  state_directory="$PROVIDER_ARTIFACT_DIRECTORY/074-authorization"
  install -d -m 0700 "$state_directory"
  require_artifact_directory "$state_directory"
  verification_file="$state_directory/role-verification.json"
  authorization_file="$state_directory/authorization.json"
  temporary_directory="$(mktemp -d "$state_directory/.verify.XXXXXX")"
  chmod 0700 "$temporary_directory"
  mapfile -d '' -t migration_mount < <(mount_readonly "$migration_file" /run/secrets/migration-database-url)
  mapfile -d '' -t plan_mount < <(mount_readonly "$plan_file" /run/secrets/role-plan.json)
  "${RUNTIME[@]}" "${migration_mount[@]}" "${plan_mount[@]}" \
    --mount "type=bind,src=$temporary_directory,dst=/run/output" \
    "$API_IMAGE" /app/scripts/ai-content-database-roles.mjs --verify \
    --migration-url-file /run/secrets/migration-database-url --plan /run/secrets/role-plan.json \
    --evidence /run/output/role-verification.json >/dev/null || fail "ai_content_database_role_verification_failed"
  require_file_mode_600 "$temporary_directory/role-verification.json" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-database-role-verification.v1"' \
    "$temporary_directory/role-verification.json" || fail "ai_content_database_role_verification_invalid"
  if [[ -e "$verification_file" || -L "$verification_file" ]]; then
    require_file_mode_600 "$verification_file" "$FILE_OWNER"
    cmp -s "$temporary_directory/role-verification.json" "$verification_file" ||
      fail "ai_content_database_role_verification_drift"
  else
    atomic_write "$verification_file" "$(<"$temporary_directory/role-verification.json")"$'\n' 600
  fi
  remove_provider_temporary_directory "$temporary_directory" "$state_directory" verify
  if [[ -e "$authorization_file" || -L "$authorization_file" ]]; then
    require_file_mode_600 "$authorization_file" "$FILE_OWNER"
  else
    local -a authorization_private_mount=() provider_private_mount=()
    mapfile -d '' -t authorization_private_mount < <(mount_readonly "$AUTHORIZATION_PRIVATE_KEY_FILE" /run/secrets/authorization-private.pem)
    mapfile -d '' -t provider_private_mount < <(mount_readonly "$PROVIDER_PRIVATE_KEY_FILE" /run/secrets/provider-private.pem)
    "${RUNTIME[@]}" "${migration_mount[@]}" "${plan_mount[@]}" \
      "${authorization_private_mount[@]}" "${provider_private_mount[@]}" \
      --mount "type=bind,src=$state_directory,dst=/run/output" \
      "$API_IMAGE" /app/scripts/ai-content-database-roles.mjs --authorize-074 \
      --migration-url-file /run/secrets/migration-database-url --plan /run/secrets/role-plan.json \
      --authorization-private-key-file /run/secrets/authorization-private.pem \
      --authorization-key-id "$AUTHORIZATION_KEY_ID" \
      --authorization-public-key-sha256 "$AUTHORIZATION_KEY_SHA256" \
      --provider-private-key-file /run/secrets/provider-private.pem --provider-key-id "$PROVIDER_KEY_ID" \
      --provider-public-key-sha256 "$PROVIDER_KEY_SHA256" \
      --image-digest "${API_IMAGE##*@}" --image-source-label "$API_SOURCE_SHA" \
      --output /run/output/authorization.json >/dev/null || fail "ai_content_074_authorization_failed"
  fi
  require_file_mode_600 "$authorization_file" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-bootstrap-role-authorization.v4"' "$authorization_file" ||
    fail "ai_content_074_authorization_invalid"
  copy_durable_evidence "$verification_file" "$verification_output" \
    "ai_content_database_role_verification_output_mismatch"
  copy_durable_evidence "$authorization_file" "$authorization_output" \
    "ai_content_074_authorization_output_mismatch"
}

run_install_074_enforcement_bundle() {
  load_runtime_release
  require_pre_marker_inactive_phase
  load_runtime
  local cutover_id admin_file migration_file plan_file stage_evidence_file attestation_output revocation_output
  local state_directory authorization_file install_request_file attestation_file revocation_file temporary_directory
  local existing_provider_output input_file
  local -a admin_mount=() migration_mount=() plan_mount=() authorization_mount=() install_mount=()
  local -a authorization_public_mount=() provider_private_mount=()
  cutover_id="$(option cutover-id)"
  admin_file="$(option admin-url-file)"
  migration_file="$(option migration-url-file)"
  plan_file="$(option plan-file)"
  stage_evidence_file="$(option stage-evidence-file)"
  attestation_output="$(option attestation-output)"
  revocation_output="$(option revocation-output)"
  require_uuid "$cutover_id"
  for input_file in "$admin_file" "$migration_file" "$plan_file" "$stage_evidence_file"; do require_secure_input "$input_file"; done
  load_provider_artifacts "$cutover_id"
  state_directory="$PROVIDER_ARTIFACT_DIRECTORY/074-authorization"
  require_artifact_directory "$state_directory"
  authorization_file="$state_directory/authorization.json"
  install_request_file="$state_directory/provider-install-request.json"
  attestation_file="$state_directory/provider-attestation.json"
  revocation_file="$state_directory/membership-revocation.json"
  require_file_mode_600 "$authorization_file" "$FILE_OWNER"
  temporary_directory="$(mktemp -d "$state_directory/.extract.XXXXXX")"
  chmod 0700 "$temporary_directory"
  local -a stage_mount=()
  mapfile -d '' -t stage_mount < <(mount_readonly "$stage_evidence_file" /run/input/074-stage-evidence.json)
  "${RUNTIME[@]}" "${stage_mount[@]}" --mount "type=bind,src=$temporary_directory,dst=/run/output" \
    "$API_IMAGE" /app/scripts/ai-content-provider-artifacts.mjs --extract-074-install-request \
    --stage-evidence-file /run/input/074-stage-evidence.json --output /run/output/install-request.json >/dev/null ||
    fail "ai_content_074_install_request_extract_failed"
  require_file_mode_600 "$temporary_directory/install-request.json" "$FILE_OWNER"
  if [[ -e "$install_request_file" || -L "$install_request_file" ]]; then
    require_file_mode_600 "$install_request_file" "$FILE_OWNER"
    cmp -s "$temporary_directory/install-request.json" "$install_request_file" ||
      fail "ai_content_074_install_request_mismatch"
  else
    atomic_write "$install_request_file" "$(<"$temporary_directory/install-request.json")"$'\n' 600
  fi
  remove_provider_temporary_directory "$temporary_directory" "$state_directory" extract
  for existing_provider_output in "$attestation_file" "$revocation_file"; do
    if [[ -e "$existing_provider_output" || -L "$existing_provider_output" ]]; then
      require_file_mode_600 "$existing_provider_output" "$FILE_OWNER"
    fi
  done
  mapfile -d '' -t admin_mount < <(mount_readonly "$admin_file" /run/secrets/provider-admin-database-url)
  mapfile -d '' -t migration_mount < <(mount_readonly "$migration_file" /run/secrets/migration-database-url)
  mapfile -d '' -t plan_mount < <(mount_readonly "$plan_file" /run/secrets/role-plan.json)
  mapfile -d '' -t authorization_mount < <(mount_readonly "$authorization_file" /run/secrets/authorization.json)
  mapfile -d '' -t install_mount < <(mount_readonly "$install_request_file" /run/secrets/provider-install-request.json)
  mapfile -d '' -t authorization_public_mount < <(mount_readonly "$AUTHORIZATION_PUBLIC_KEY_FILE" /run/secrets/authorization-public.pem)
  mapfile -d '' -t provider_private_mount < <(mount_readonly "$PROVIDER_PRIVATE_KEY_FILE" /run/secrets/provider-private.pem)
  "${RUNTIME[@]}" "${admin_mount[@]}" "${migration_mount[@]}" "${plan_mount[@]}" "${authorization_mount[@]}" \
    "${install_mount[@]}" "${authorization_public_mount[@]}" "${provider_private_mount[@]}" \
    --mount "type=bind,src=$state_directory,dst=/run/output" \
    "$API_IMAGE" /app/scripts/ai-content-database-roles.mjs --install-074-enforcement-bundle \
    --admin-url-file /run/secrets/provider-admin-database-url \
    --migration-url-file /run/secrets/migration-database-url --plan /run/secrets/role-plan.json \
    --authorization /run/secrets/authorization.json --install-request /run/secrets/provider-install-request.json \
    --authorization-public-key-file /run/secrets/authorization-public.pem \
    --authorization-key-id "$AUTHORIZATION_KEY_ID" --authorization-public-key-sha256 "$AUTHORIZATION_KEY_SHA256" \
    --provider-private-key-file /run/secrets/provider-private.pem --provider-key-id "$PROVIDER_KEY_ID" \
    --provider-public-key-sha256 "$PROVIDER_KEY_SHA256" \
    --attestation-output /run/output/provider-attestation.json \
    --revocation-output /run/output/membership-revocation.json >/dev/null ||
    fail "ai_content_074_provider_install_failed"
  require_file_mode_600 "$attestation_file" "$FILE_OWNER"
  require_file_mode_600 "$revocation_file" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-074-provider-attestation.v4"' "$attestation_file" ||
    fail "ai_content_074_provider_attestation_invalid"
  grep -q '"contractVersion":"ai-content-074-membership-revocation-request.v2"' "$revocation_file" ||
    fail "ai_content_074_provider_revocation_invalid"
  copy_durable_evidence "$attestation_file" "$attestation_output" \
    "ai_content_074_provider_attestation_output_mismatch"
  copy_durable_evidence "$revocation_file" "$revocation_output" \
    "ai_content_074_provider_revocation_output_mismatch"
}

run_install_075_ddl_allowlist() {
  load_runtime_release
  load_runtime
  local cutover_id admin_file plan_file consume_evidence_file authorization_output attestation_output
  local state_directory authorization_file attestation_file revocation_file journal_directory temporary_directory
  local existing_provider_output input_file
  local -a consume_mount=() revocation_mount=() admin_mount=() plan_mount=()
  local -a authorization_private_mount=() provider_private_mount=()
  cutover_id="$(option cutover-id)"
  admin_file="$(option admin-url-file)"
  plan_file="$(option plan-file)"
  consume_evidence_file="$(option consume-evidence-file)"
  authorization_output="$(option authorization-output)"
  attestation_output="$(option attestation-output)"
  require_uuid "$cutover_id"
  require_active_cutover "$cutover_id"
  for input_file in "$admin_file" "$plan_file" "$consume_evidence_file"; do require_secure_input "$input_file"; done
  load_provider_artifacts "$cutover_id"
  revocation_file="$PROVIDER_ARTIFACT_DIRECTORY/074-authorization/membership-revocation.json"
  require_file_mode_600 "$revocation_file" "$FILE_OWNER"
  state_directory="$PROVIDER_ARTIFACT_DIRECTORY/075-allowlist"
  journal_directory="$state_directory/journal"
  install -d -m 0700 "$state_directory" "$journal_directory"
  require_artifact_directory "$state_directory"
  require_artifact_directory "$journal_directory"
  authorization_file="$state_directory/authorization.json"
  attestation_file="$state_directory/attestation.json"
  temporary_directory="$(mktemp -d "$state_directory/.consume.XXXXXX")"
  chmod 0700 "$temporary_directory"
  mapfile -d '' -t consume_mount < <(mount_readonly "$consume_evidence_file" /run/input/074-consume-evidence.json)
  mapfile -d '' -t revocation_mount < <(mount_readonly "$revocation_file" /run/input/membership-revocation.json)
  "${RUNTIME[@]}" "${consume_mount[@]}" "${revocation_mount[@]}" \
    --mount "type=bind,src=$temporary_directory,dst=/run/output" \
    "$API_IMAGE" /app/scripts/ai-content-provider-artifacts.mjs --parse-074-consume-evidence \
    --consume-evidence-file /run/input/074-consume-evidence.json \
    --revocation-file /run/input/membership-revocation.json --output /run/output/revocation.json >/dev/null ||
    fail "ai_content_074_consume_evidence_invalid"
  cmp -s "$temporary_directory/revocation.json" "$revocation_file" || fail "ai_content_074_revocation_mismatch"
  remove_provider_temporary_directory "$temporary_directory" "$state_directory" consume
  for existing_provider_output in "$authorization_file" "$attestation_file"; do
    if [[ -e "$existing_provider_output" || -L "$existing_provider_output" ]]; then
      require_file_mode_600 "$existing_provider_output" "$FILE_OWNER"
    fi
  done
  mapfile -d '' -t admin_mount < <(mount_readonly "$admin_file" /run/secrets/provider-admin-database-url)
  mapfile -d '' -t plan_mount < <(mount_readonly "$plan_file" /run/secrets/role-plan.json)
  mapfile -d '' -t authorization_private_mount < <(mount_readonly "$AUTHORIZATION_PRIVATE_KEY_FILE" /run/secrets/authorization-private.pem)
  mapfile -d '' -t provider_private_mount < <(mount_readonly "$PROVIDER_PRIVATE_KEY_FILE" /run/secrets/provider-private.pem)
  "${RUNTIME[@]}" "${admin_mount[@]}" "${plan_mount[@]}" \
    "${authorization_private_mount[@]}" "${provider_private_mount[@]}" \
    --mount "type=bind,src=$state_directory,dst=/run/output" \
    "$API_IMAGE" /app/scripts/ai-content-database-roles.mjs --install-075-ddl-allowlist \
    --admin-url-file /run/secrets/provider-admin-database-url --plan /run/secrets/role-plan.json \
    --cutover-id "$cutover_id" --authorization-private-key-file /run/secrets/authorization-private.pem \
    --authorization-key-id "$AUTHORIZATION_KEY_ID" \
    --authorization-public-key-sha256 "$AUTHORIZATION_KEY_SHA256" \
    --provider-private-key-file /run/secrets/provider-private.pem --provider-key-id "$PROVIDER_KEY_ID" \
    --provider-public-key-sha256 "$PROVIDER_KEY_SHA256" \
    --journal-dir /run/output/journal --authorization-output /run/output/authorization.json \
    --attestation-output /run/output/attestation.json >/dev/null || fail "ai_content_075_allowlist_install_failed"
  require_file_mode_600 "$authorization_file" "$FILE_OWNER"
  require_file_mode_600 "$attestation_file" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-075-ddl-allowlist-authorization.v1"' "$authorization_file" ||
    fail "ai_content_075_allowlist_authorization_invalid"
  grep -q '"contractVersion":"ai-content-075-ddl-allowlist-attestation.v1"' "$attestation_file" ||
    fail "ai_content_075_allowlist_attestation_invalid"
  copy_durable_evidence "$authorization_file" "$authorization_output" \
    "ai_content_075_allowlist_authorization_output_mismatch"
  copy_durable_evidence "$attestation_file" "$attestation_output" \
    "ai_content_075_allowlist_attestation_output_mismatch"
}

validate_prepare_input_artifact() {
  local artifact_file="$1"
  local checksum_file="$2"
  local artifact_name="$3"
  local contract_marker="$4"
  local actual_sha256
  require_file_mode_600 "$artifact_file" "$FILE_OWNER"
  require_file_mode_600 "$checksum_file" "$FILE_OWNER"
  actual_sha256="$(sha256sum -- "$artifact_file")"
  actual_sha256="${actual_sha256%% *}"
  require_hex "$actual_sha256" 64
  printf '%s  %s\n' "$actual_sha256" "$artifact_name" | cmp -s - "$checksum_file" ||
    fail "ai_content_prepare_input_checksum_invalid"
  grep -Fq "\"schema_version\":\"$contract_marker\"" "$artifact_file" ||
    fail "ai_content_prepare_input_contract_invalid"
}

run_collect_prepare_inputs() {
  load_runtime_release
  require_pre_marker_inactive_phase
  load_runtime
  local cutover_id admin_file incident_output preserved_output state_directory
  local incident_file incident_checksum_file preserved_file preserved_checksum_file artifact_file
  local existing_count=0
  local -a admin_mount=()
  cutover_id="$(option cutover-id)"
  admin_file="$(option admin-url-file)"
  incident_output="$(option incident-output)"
  preserved_output="$(option preserved-output)"
  require_uuid "$cutover_id"
  require_secure_input "$admin_file"
  [[ "$incident_output" != "$preserved_output" ]] || fail "ai_content_prepare_input_outputs_invalid"
  load_provider_artifacts "$cutover_id"
  state_directory="$PROVIDER_ARTIFACT_DIRECTORY/prepare-inputs"
  install -d -m 0700 "$state_directory"
  require_artifact_directory "$state_directory"
  incident_file="$state_directory/incident-evidence.json"
  incident_checksum_file="$state_directory/incident-evidence.json.sha256"
  preserved_file="$state_directory/preserved-data-catalog.json"
  preserved_checksum_file="$state_directory/preserved-data-catalog.json.sha256"
  for artifact_file in "$incident_file" "$incident_checksum_file" \
    "$preserved_file" "$preserved_checksum_file"; do
    if [[ -e "$artifact_file" || -L "$artifact_file" ]]; then
      existing_count="$((existing_count + 1))"
    fi
  done
  if (( existing_count == 0 )); then
    mapfile -d '' -t admin_mount < <(mount_readonly "$admin_file" /run/secrets/provider-admin-database-url)
    "${RUNTIME[@]}" "${admin_mount[@]}" \
      --mount "type=bind,src=$state_directory,dst=/run/output" \
      "$API_IMAGE" /app/scripts/collect-ai-content-prepare-evidence.mjs \
      --admin-url-file /run/secrets/provider-admin-database-url \
      --output-directory /run/output --execution-graph-root /app >/dev/null ||
      fail "ai_content_prepare_input_collection_failed"
  elif (( existing_count != 4 )); then
    fail "ai_content_prepare_input_state_incomplete"
  fi
  validate_prepare_input_artifact "$incident_file" "$incident_checksum_file" \
    incident-evidence.json ai-content-cutover-evidence.v2
  validate_prepare_input_artifact "$preserved_file" "$preserved_checksum_file" \
    preserved-data-catalog.json ai-content-preserved-data-catalog.v2
  copy_durable_evidence "$incident_file" "$incident_output" \
    "ai_content_prepare_incident_output_mismatch"
  copy_durable_evidence "$preserved_file" "$preserved_output" \
    "ai_content_prepare_preserved_output_mismatch"
}

run_create_prepare_evidence() {
  load_runtime_release
  require_pre_marker_inactive_phase
  load_runtime
  local cutover_id provider_backup_id provider_snapshot_created_at incident_file preserved_file preflight_file output_file
  local state_directory role_verification_file body_file evidence_file temporary_directory generated
  local input_file
  local -a bypass_mount=() cleanup_mount=() role_mount=() incident_mount=() preserved_mount=() preflight_mount=() body_mount=()
  cutover_id="$(option cutover-id)"
  provider_backup_id="$(option provider-backup-id)"
  provider_snapshot_created_at="$(option provider-snapshot-created-at)"
  incident_file="$(option incident-bundle-file)"
  preserved_file="$(option preserved-data-manifest-file)"
  preflight_file="$(option preflight-evidence-file)"
  output_file="$(option output)"
  require_uuid "$cutover_id"
  for input_file in "$incident_file" "$preserved_file" "$preflight_file"; do require_secure_input "$input_file"; done
  load_provider_artifacts "$cutover_id"
  role_verification_file="$PROVIDER_ARTIFACT_DIRECTORY/074-authorization/role-verification.json"
  require_file_mode_600 "$role_verification_file" "$FILE_OWNER"
  state_directory="$PROVIDER_ARTIFACT_DIRECTORY/prepare"
  install -d -m 0700 "$state_directory"
  require_artifact_directory "$state_directory"
  body_file="$state_directory/body.json"
  evidence_file="$state_directory/evidence.json"
  temporary_directory="$(mktemp -d "$state_directory/.prepare.XXXXXX")"
  chmod 0700 "$temporary_directory"
  mapfile -d '' -t bypass_mount < <(mount_readonly "$BYPASS_TOKEN_FILE" /run/secrets/bypass-token)
  mapfile -d '' -t cleanup_mount < <(mount_readonly "$CLEANUP_TOKEN_FILE" /run/secrets/cleanup-token)
  mapfile -d '' -t role_mount < <(mount_readonly "$role_verification_file" /run/input/role-verification.json)
  mapfile -d '' -t incident_mount < <(mount_readonly "$incident_file" /run/input/incident-bundle)
  mapfile -d '' -t preserved_mount < <(mount_readonly "$preserved_file" /run/input/preserved-data-manifest)
  mapfile -d '' -t preflight_mount < <(mount_readonly "$preflight_file" /run/input/proposal-preflight.json)
  "${RUNTIME[@]}" "${bypass_mount[@]}" "${cleanup_mount[@]}" "${role_mount[@]}" \
    "${incident_mount[@]}" "${preserved_mount[@]}" "${preflight_mount[@]}" \
    --mount "type=bind,src=$temporary_directory,dst=/run/output" \
    "$API_IMAGE" /app/scripts/ai-content-provider-artifacts.mjs --create-prepare-body \
    --cutover-id "$cutover_id" --release-sha "$RELEASE_SHA" \
    --bypass-token-file /run/secrets/bypass-token --cleanup-token-file /run/secrets/cleanup-token \
    --role-verification-file /run/input/role-verification.json --provider-backup-id "$provider_backup_id" \
    --provider-snapshot-created-at "$provider_snapshot_created_at" \
    --incident-bundle-file /run/input/incident-bundle \
    --preserved-data-manifest-file /run/input/preserved-data-manifest \
    --proposal-preflight-file /run/input/proposal-preflight.json --output /run/output/body.json >/dev/null ||
    fail "ai_content_prepare_body_generation_failed"
  require_file_mode_600 "$temporary_directory/body.json" "$FILE_OWNER"
  if [[ -e "$body_file" || -L "$body_file" ]]; then
    require_file_mode_600 "$body_file" "$FILE_OWNER"
    cmp -s "$temporary_directory/body.json" "$body_file" || fail "ai_content_prepare_body_mismatch"
  else
    atomic_write "$body_file" "$(<"$temporary_directory/body.json")"$'\n' 600
  fi
  remove_provider_temporary_directory "$temporary_directory" "$state_directory" prepare
  mapfile -d '' -t body_mount < <(mount_readonly "$body_file" /run/input/prepare-body.json)
  generated="$("${RUNTIME[@]}" "${body_mount[@]}" "$API_IMAGE" \
    /app/scripts/ai-content-cutover-control.mjs --create-prepare-evidence \
    --body-file /run/input/prepare-body.json)" || fail "ai_content_prepare_evidence_generation_failed"
  [[ -n "$generated" ]] || fail "ai_content_prepare_evidence_generation_failed"
  if [[ -e "$evidence_file" || -L "$evidence_file" ]]; then
    require_file_mode_600 "$evidence_file" "$FILE_OWNER"
    [[ "$(<"$evidence_file")" == "$generated" ]] || fail "ai_content_prepare_evidence_mismatch"
  else
    atomic_write "$evidence_file" "$generated"$'\n' 600
  fi
  copy_durable_evidence "$evidence_file" "$output_file" "ai_content_prepare_evidence_output_mismatch"
}

run_role_plan() {
  load_staged_release
  load_runtime
  local admin_file output_file output_directory output_name
  admin_file="$(option admin-url-file)"
  output_file="$(option output)"
  require_secure_input "$admin_file"
  [[ "$output_file" =~ ^/[a-zA-Z0-9._/-]+$ && ! -e "$output_file" && ! -L "$output_file" ]] ||
    fail "ai_content_role_plan_output_invalid"
  output_directory="$(dirname -- "$output_file")"
  output_name="$(basename -- "$output_file")"
  [[ -d "$output_directory" && ! -L "$output_directory" ]] || fail "ai_content_role_plan_output_directory_missing"
  local -a admin_mount=()
  mapfile -d '' -t admin_mount < <(mount_readonly "$admin_file" /run/input/admin-database-url)
  "${RUNTIME[@]}" "${admin_mount[@]}" \
    --mount "type=bind,src=$output_directory,dst=/run/output" \
    "$API_IMAGE" /app/scripts/ai-content-database-roles.mjs --plan \
    --admin-url-file /run/input/admin-database-url \
    --output "/run/output/$output_name" >/dev/null || fail "ai_content_role_plan_failed"
  require_file_mode_600 "$output_file" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-database-role-plan.v1"' "$output_file" ||
    fail "ai_content_role_plan_evidence_invalid"
}

run_role_bootstrap() {
  load_staged_release
  load_runtime
  local admin_file plan_file output_file state_parent generated_directory generated_evidence
  admin_file="$(option admin-url-file)"
  plan_file="$(option plan-file)"
  output_file="$(option output)"
  require_secure_input "$admin_file"
  require_secure_input "$plan_file"
  [[ "$output_file" =~ ^/[a-zA-Z0-9._/-]+$ && ! -L "$output_file" ]] ||
    fail "ai_content_role_bootstrap_output_invalid"
  [[ -d "$(dirname -- "$output_file")" && ! -L "$(dirname -- "$output_file")" ]] ||
    fail "ai_content_role_bootstrap_output_directory_missing"
  [[ -d "$ROOT/shared/secrets" && ! -L "$ROOT/shared/secrets" ]] ||
    fail "ai_content_role_bootstrap_secret_directory_missing"

  state_parent="$ROOT/state/ai-content-role-bootstrap-$RELEASE_SHA"
  generated_directory="$state_parent/generated"
  generated_evidence="$state_parent/apply-evidence.json"
  if [[ -e "$state_parent" || -L "$state_parent" ]]; then
    [[ -d "$state_parent" && ! -L "$state_parent" && -d "$generated_directory" &&
      ! -L "$generated_directory" && -f "$generated_evidence" && ! -L "$generated_evidence" ]] ||
      fail "ai_content_role_bootstrap_state_incomplete"
    local recovered_role
    for recovered_role in application operator migration cleanup; do
      [[ -f "$generated_directory/$recovered_role-database-url" &&
        ! -L "$generated_directory/$recovered_role-database-url" ]] ||
        fail "ai_content_role_bootstrap_state_incomplete"
    done
  else
    install -d -m 0700 "$state_parent"
    local -a admin_mount=() plan_mount=()
    mapfile -d '' -t admin_mount < <(mount_readonly "$admin_file" /run/input/admin-database-url)
    mapfile -d '' -t plan_mount < <(mount_readonly "$plan_file" /run/input/role-plan.json)
    "${RUNTIME[@]}" "${admin_mount[@]}" "${plan_mount[@]}" \
      --mount "type=bind,src=$state_parent,dst=/run/output" \
      "$API_IMAGE" /app/scripts/ai-content-database-roles.mjs --apply \
      --admin-url-file /run/input/admin-database-url \
      --plan /run/input/role-plan.json \
      --secret-output-dir /run/output/generated \
      --evidence /run/output/apply-evidence.json >/dev/null || fail "ai_content_role_bootstrap_failed"
  fi

  local role source target value
  for role in application operator migration cleanup; do
    source="$generated_directory/$role-database-url"
    case "$role" in
      application) target="$ROOT/shared/secrets/ai-content-application-database-url" ;;
      operator) target="$ROOT/shared/secrets/ai-content-operator-database-url" ;;
      migration) target="$ROOT/shared/secrets/ai-content-migration-database-url" ;;
      cleanup) target="$ROOT/shared/secrets/ai-content-cleanup-database-url" ;;
      *) fail "ai_content_role_bootstrap_role_invalid" ;;
    esac
    require_file_mode_600 "$source" "$FILE_OWNER"
    value="$(<"$source")"
    [[ "$value" =~ ^postgres(ql)?://[^[:space:]]+$ ]] || fail "ai_content_role_bootstrap_secret_invalid"
    if [[ -e "$target" || -L "$target" ]]; then
      [[ -f "$target" && ! -L "$target" ]] || fail "ai_content_role_bootstrap_secret_mismatch"
      require_file_mode_600 "$target" "$FILE_OWNER"
      cmp -s "$source" "$target" || fail "ai_content_role_bootstrap_secret_mismatch"
    else
      atomic_write "$target" "${value}"$'\n' 600
    fi
  done
  require_file_mode_600 "$generated_evidence" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-database-role-apply-evidence.v1"' "$generated_evidence" ||
    fail "ai_content_role_bootstrap_evidence_invalid"
  if [[ -e "$output_file" || -L "$output_file" ]]; then
    [[ -f "$output_file" && ! -L "$output_file" ]] || fail "ai_content_role_bootstrap_output_mismatch"
    require_file_mode_600 "$output_file" "$FILE_OWNER"
    cmp -s "$generated_evidence" "$output_file" || fail "ai_content_role_bootstrap_output_mismatch"
  else
    atomic_write "$output_file" "$(<"$generated_evidence")"$'\n' 600
  fi
}

run_073a() {
  load_staged_release
  load_runtime
  local database_file output_file output
  database_file="$(option admin-url-file)"
  output_file="$(option output)"
  require_secure_input "$database_file"
  local -a database_mount=()
  mapfile -d '' -t database_mount < <(mount_readonly "$database_file" /run/secrets/admin-database-url)
  output="$("${RUNTIME[@]}" "${database_mount[@]}" \
    --env SUPABASE_DATABASE_URL_FILE=/run/secrets/admin-database-url \
    --env AI_CONTENT_074_PREREQUISITE_PROVIDER_ROLE=postgres \
    "$API_IMAGE" /app/scripts/migrate.mjs --bootstrap-074-prerequisite)" ||
    fail "ai_content_cutover_073a_failed"
  grep -q '"bootstrap074PrerequisiteMigrationId": "073a_legacy_trigger_function_search_path.sql"' <<<"$output" ||
    fail "ai_content_cutover_073a_evidence_invalid"
  grep -q '"bootstrap074PrerequisiteProviderRoleName": "postgres"' <<<"$output" ||
    fail "ai_content_cutover_073a_evidence_invalid"
  grep -q '"bootstrap074RestartRequired": true' <<<"$output" ||
    fail "ai_content_cutover_073a_evidence_invalid"
  capture_evidence "$output_file" printf '%s' "$output"
}

load_bootstrap_inputs() {
  AUTHORIZATION_FILE="$(option authorization-file)"
  AUTHORIZATION_PUBLIC_KEY_FILE="$(option authorization-public-key-file)"
  PROVIDER_PUBLIC_KEY_FILE="$(option provider-public-key-file)"
  AUTHORIZATION_KEY_ID="$(option authorization-key-id)"
  PROVIDER_KEY_ID="$(option provider-key-id)"
  AUTHORIZATION_KEY_SHA256="$(option authorization-key-sha256)"
  PROVIDER_KEY_SHA256="$(option provider-key-sha256)"
  require_secure_input "$AUTHORIZATION_FILE"
  require_secure_input "$AUTHORIZATION_PUBLIC_KEY_FILE"
  require_secure_input "$PROVIDER_PUBLIC_KEY_FILE"
  [[ "$AUTHORIZATION_KEY_ID" =~ ^[A-Za-z0-9._:-]{1,128}$ ]] || fail "ai_content_cutover_key_id_invalid"
  [[ "$PROVIDER_KEY_ID" =~ ^[A-Za-z0-9._:-]{1,128}$ ]] || fail "ai_content_cutover_key_id_invalid"
  require_hex "$AUTHORIZATION_KEY_SHA256" 64
  require_hex "$PROVIDER_KEY_SHA256" 64
  mapfile -d '' -t BOOTSTRAP_ENV < <(bootstrap_public_environment \
    "$AUTHORIZATION_KEY_ID" "$AUTHORIZATION_KEY_SHA256" "$PROVIDER_KEY_ID" "$PROVIDER_KEY_SHA256")
  mapfile -d '' -t AUTHORIZATION_MOUNT < <(mount_readonly "$AUTHORIZATION_FILE" /run/secrets/authorization.json)
  mapfile -d '' -t AUTHORIZATION_PUBLIC_MOUNT < <(mount_readonly "$AUTHORIZATION_PUBLIC_KEY_FILE" /run/secrets/authorization-public.pem)
  mapfile -d '' -t PROVIDER_PUBLIC_MOUNT < <(mount_readonly "$PROVIDER_PUBLIC_KEY_FILE" /run/secrets/provider-public.pem)
}

run_074() {
  local consume_attestation="$1"
  load_runtime_release
  require_pre_marker_inactive_phase
  load_runtime
  load_role_environment
  load_bootstrap_inputs
  local database_file output_file output provider_attestation_file=""
  local -a database_mount=() provider_attestation_mount=() provider_attestation_env=() consumed_recovery_env=()
  database_file="$(option migration-url-file)"
  output_file="$(option output)"
  require_secure_input "$database_file"
  mapfile -d '' -t database_mount < <(mount_readonly "$database_file" /run/secrets/migration-database-url)
  if [[ "$consume_attestation" == "true" ]]; then
    provider_attestation_file="$(option provider-attestation-file)"
    require_secure_input "$provider_attestation_file"
    mapfile -d '' -t provider_attestation_mount < <(mount_readonly "$provider_attestation_file" /run/secrets/provider-attestation.json)
    provider_attestation_env=(--env AI_CONTENT_074_PROVIDER_ATTESTATION_FILE=/run/secrets/provider-attestation.json)
    consumed_recovery_env=(--env AI_CONTENT_074_ALLOW_CONSUMED_RECOVERY=true)
  fi
  if [[ -e "$output_file" || -L "$output_file" ]]; then
    require_file_mode_600 "$output_file" "$FILE_OWNER"
    if [[ "$consume_attestation" == "true" ]]; then
      grep -Eq '"bootstrap074Stage": "provider_evidence_(already_)?consumed"' "$output_file" ||
        fail "ai_content_cutover_074_consume_evidence_invalid"
      grep -q '"revocationRequest"' "$output_file" || fail "ai_content_cutover_074_consume_evidence_invalid"
    else
      grep -q '"bootstrap074Stage": "provider_install_required"' "$output_file" ||
        fail "ai_content_cutover_074_stage_evidence_invalid"
      grep -q '"providerInstallRequest"' "$output_file" || fail "ai_content_cutover_074_stage_evidence_invalid"
    fi
    return
  fi
  output="$("${RUNTIME[@]}" "${database_mount[@]}" "${AUTHORIZATION_MOUNT[@]}" \
    "${AUTHORIZATION_PUBLIC_MOUNT[@]}" "${PROVIDER_PUBLIC_MOUNT[@]}" \
    "${provider_attestation_mount[@]}" --env SUPABASE_DATABASE_URL_FILE=/run/secrets/migration-database-url \
    "${ROLE_ENV[@]}" "${BOOTSTRAP_ENV[@]}" "${provider_attestation_env[@]}" "${consumed_recovery_env[@]}" \
    "$API_IMAGE" /app/scripts/migrate.mjs)" || fail "ai_content_cutover_074_failed"
  if [[ "$consume_attestation" == "true" ]]; then
    grep -Eq '"bootstrap074Stage": "provider_evidence_(already_)?consumed"' <<<"$output" ||
      fail "ai_content_cutover_074_consume_evidence_invalid"
  else
    grep -q '"bootstrap074Stage": "provider_install_required"' <<<"$output" ||
      fail "ai_content_cutover_074_stage_evidence_invalid"
    grep -q '"providerInstallRequest"' <<<"$output" || fail "ai_content_cutover_074_stage_evidence_invalid"
  fi
  capture_evidence "$output_file" printf '%s' "$output"
}

run_075() {
  load_runtime_release
  load_runtime
  load_role_environment
  load_bootstrap_inputs
  local database_file output_file cutover_id bypass_token_file provider_attestation_file
  local allowlist_authorization_file allowlist_attestation_file preflight_evidence_file output
  database_file="$(option migration-url-file)"
  output_file="$(option output)"
  cutover_id="$(option cutover-id)"
  bypass_token_file="$(option bypass-token-file)"
  provider_attestation_file="$(option provider-attestation-file)"
  allowlist_authorization_file="$(option allowlist-authorization-file)"
  allowlist_attestation_file="$(option allowlist-attestation-file)"
  preflight_evidence_file="$(option preflight-evidence-file)"
  require_uuid "$cutover_id"
  require_active_cutover "$cutover_id"
  for input_file in "$database_file" "$bypass_token_file" "$provider_attestation_file" \
    "$allowlist_authorization_file" "$allowlist_attestation_file" "$preflight_evidence_file"; do
    require_secure_input "$input_file"
  done
  local -a database_mount=() bypass_mount=() provider_attestation_mount=()
  local -a allowlist_authorization_mount=() allowlist_attestation_mount=() preflight_mount=()
  mapfile -d '' -t database_mount < <(mount_readonly "$database_file" /run/secrets/migration-database-url)
  mapfile -d '' -t bypass_mount < <(mount_readonly "$bypass_token_file" /run/secrets/cutover-token)
  mapfile -d '' -t provider_attestation_mount < <(mount_readonly "$provider_attestation_file" /run/secrets/provider-attestation.json)
  mapfile -d '' -t allowlist_authorization_mount < <(mount_readonly "$allowlist_authorization_file" /run/secrets/allowlist-authorization.json)
  mapfile -d '' -t allowlist_attestation_mount < <(mount_readonly "$allowlist_attestation_file" /run/secrets/allowlist-attestation.json)
  mapfile -d '' -t preflight_mount < <(mount_readonly "$preflight_evidence_file" /run/secrets/proposal-preflight.json)
  output="$("${RUNTIME[@]}" "${database_mount[@]}" "${AUTHORIZATION_MOUNT[@]}" \
    "${AUTHORIZATION_PUBLIC_MOUNT[@]}" "${PROVIDER_PUBLIC_MOUNT[@]}" \
    "${bypass_mount[@]}" "${provider_attestation_mount[@]}" \
    "${allowlist_authorization_mount[@]}" "${allowlist_attestation_mount[@]}" "${preflight_mount[@]}" \
    --env SUPABASE_DATABASE_URL_FILE=/run/secrets/migration-database-url \
    "${ROLE_ENV[@]}" "${BOOTSTRAP_ENV[@]}" \
    --env AI_CONTENT_074_PROVIDER_ATTESTATION_FILE=/run/secrets/provider-attestation.json \
    --env "AI_CONTENT_075_CUTOVER_ID=$cutover_id" \
    --env AI_CONTENT_075_BYPASS_TOKEN_FILE=/run/secrets/cutover-token \
    --env AI_CONTENT_075_EXPECTED_DATABASE_ROLE=content_migration \
    --env AI_CONTENT_075_ALLOWLIST_AUTHORIZATION_FILE=/run/secrets/allowlist-authorization.json \
    --env AI_CONTENT_075_ALLOWLIST_ATTESTATION_FILE=/run/secrets/allowlist-attestation.json \
    --env AI_CONTENT_075_PREFLIGHT_EVIDENCE_FILE=/run/secrets/proposal-preflight.json \
    --env AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_FILE=/run/secrets/authorization-public.pem \
    --env "AI_CONTENT_075_AUTHORIZATION_KEY_ID=$AUTHORIZATION_KEY_ID" \
    --env "AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_SHA256=$AUTHORIZATION_KEY_SHA256" \
    --env AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE=/run/secrets/provider-public.pem \
    --env "AI_CONTENT_075_PROVIDER_ATTESTATION_KEY_ID=$PROVIDER_KEY_ID" \
    --env "AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256=$PROVIDER_KEY_SHA256" \
    "$API_IMAGE" /app/scripts/migrate.mjs)" || fail "ai_content_cutover_075_failed"
  grep -q '"status": "migration_body_complete"' <<<"$output" || fail "ai_content_cutover_075_evidence_invalid"
  capture_evidence "$output_file" printf '%s' "$output"
}

run_proposal_preflight() {
  load_staged_release
  local cutover_id identity_file schema_file codex_home_source output_file worker_image worker_source_sha
  cutover_id="$(option cutover-id)"
  identity_file="$(option identity-file)"
  schema_file="$(option schema-file)"
  codex_home_source="$(option codex-home-source)"
  output_file="$(option output)"
  require_uuid "$cutover_id"
  require_secure_input "$identity_file"
  [[ -f "$schema_file" && ! -L "$schema_file" ]] || fail "proposal_preflight_schema_file_invalid"
  [[ -d "$codex_home_source" && ! -L "$codex_home_source" ]] || fail "proposal_preflight_codex_home_invalid"
  worker_image="${RELEASE_MANIFEST[CONTENT_PROPOSAL_WORKER_IMAGE]}"
  worker_source_sha="$(release_image_source_revision CONTENT_PROPOSAL_WORKER_IMAGE)"
  verify_release_image_revision "$worker_image" "$worker_source_sha"
  [[ "$(docker image inspect --format '{{.Config.User}}' "$worker_image")" == "node" ]] ||
    fail "proposal_preflight_image_user_invalid"
  local image_uid image_gid runtime_uid runtime_gid
  image_uid="$(docker run --rm --entrypoint id "$worker_image" -u)"
  image_gid="$(docker run --rm --entrypoint id "$worker_image" -g)"
  [[ "$image_uid" =~ ^[0-9]+$ && "$image_gid" =~ ^[0-9]+$ ]] ||
    fail "proposal_preflight_image_identity_invalid"
  (( image_uid > 0 && image_gid > 0 )) ||
    fail "proposal_preflight_image_identity_invalid"
  runtime_uid="$(id -u)"
  runtime_gid="$(id -g)"
  [[ "$runtime_uid" =~ ^[0-9]+$ && "$runtime_gid" =~ ^[0-9]+$ ]] ||
    fail "proposal_preflight_runtime_identity_mismatch"
  (( runtime_uid > 0 && runtime_gid > 0 )) ||
    fail "proposal_preflight_runtime_identity_mismatch"
  local state_parent state_directory codex_copy output
  state_parent="$ROOT/state/ai-content-cutovers/$cutover_id"
  state_directory="$state_parent/proposal-v2-preflight"
  install -d -m 0700 "$ROOT/state/ai-content-cutovers" "$state_parent" "$state_directory"
  codex_copy="$(mktemp -d "$state_parent/codex-home.XXXXXX")"
  cleanup_codex_copy() {
    [[ "$codex_copy" == "$state_parent"/codex-home.* ]] || fail "proposal_preflight_cleanup_target_invalid"
    rm -rf -- "$codex_copy"
  }
  trap cleanup_codex_copy EXIT
  cp -a "$codex_home_source/." "$codex_copy/"
  chmod 0700 "$codex_copy"
  output="$(docker run --rm --read-only --user "$runtime_uid:$runtime_gid" \
    --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    --env CODEX_HOME=/codex \
    --mount "type=bind,src=$codex_copy,dst=/codex" \
    --mount "type=bind,src=$state_directory,dst=/app/artifacts/ai-content-cutover/075_ai_content_three_format_cutover/proposal-v2-preflight" \
    --mount "type=bind,src=$identity_file,dst=/run/input/identity.json,readonly" \
    --mount "type=bind,src=$schema_file,dst=/run/input/schema.json,readonly" \
    --entrypoint node "$worker_image" /app/scripts/ai-content-proposal-schema-preflight.mjs \
    --execute-once --identity-file /run/input/identity.json --schema-file /run/input/schema.json \
    --state-dir /app/artifacts/ai-content-cutover/075_ai_content_three_format_cutover/proposal-v2-preflight \
    --cutover-id "$cutover_id")" || fail "proposal_preflight_failed"
  grep -q '"contractVersion":"ai-content-075-proposal-preflight-evidence.v1"' <<<"$output" ||
    fail "proposal_preflight_evidence_invalid"
  chmod 0400 "$state_directory"/*
  chmod 0500 "$state_directory"
  capture_evidence "$output_file" printf '%s' "$output"
  trap - EXIT
  cleanup_codex_copy
}

require_active_cutover() {
  local expected_cutover_id="$1"
  local state_file="$ROOT/state/ai-content-cutover-id"
  local active_cutover_id
  require_secure_state_file "$state_file"
  active_cutover_id="$(<"$state_file")"
  require_uuid "$active_cutover_id"
  [[ "$active_cutover_id" == "$expected_cutover_id" ]] || fail "ai_content_cutover_active_id_mismatch"
}

run_control() {
  local control_mode="$1"
  load_runtime_release
  load_runtime
  local database_file cutover_id output_file output
  local clear_active_cutover=false
  local -a database_mount=() command_args=()
  database_file="$(option operator-url-file)"
  cutover_id="$(option cutover-id)"
  output_file="$(option output)"
  require_secure_input "$database_file"
  require_uuid "$cutover_id"
  mapfile -d '' -t database_mount < <(mount_readonly "$database_file" /run/secrets/operator-database-url)
  case "$control_mode" in
    --prepare)
      local evidence_file
      local -a evidence_mount=()
      evidence_file="$(option evidence-file)"
      require_secure_input "$evidence_file"
      mapfile -d '' -t evidence_mount < <(mount_readonly "$evidence_file" /run/secrets/prepare-evidence.json)
      command_args=(--prepare --database-url-file /run/secrets/operator-database-url \
        --evidence-file /run/secrets/prepare-evidence.json)
      output="$("${RUNTIME[@]}" "${database_mount[@]}" "${evidence_mount[@]}" \
        "$API_IMAGE" /app/scripts/ai-content-cutover-control.mjs "${command_args[@]}")" ||
        fail "ai_content_cutover_prepare_failed"
      grep -q "\"cutoverId\":\"$cutover_id\"" <<<"$output" || fail "ai_content_cutover_prepare_evidence_invalid"
      grep -q '"status":"prepared"' <<<"$output" || fail "ai_content_cutover_prepare_evidence_invalid"
      atomic_write "$ROOT/state/ai-content-cutover-id" "${cutover_id}"$'\n' 600
      ;;
    --enable-maintenance)
      require_active_cutover "$cutover_id"
      command_args=(--enable-maintenance --database-url-file /run/secrets/operator-database-url --cutover-id "$cutover_id")
      output="$("${RUNTIME[@]}" "${database_mount[@]}" "$API_IMAGE" \
        /app/scripts/ai-content-cutover-control.mjs "${command_args[@]}")" ||
        fail "ai_content_cutover_enable_maintenance_failed"
      grep -q '"maintenanceEnabled":true' <<<"$output" || fail "ai_content_cutover_maintenance_evidence_invalid"
      ;;
    --verify-maintenance)
      require_active_cutover "$cutover_id"
      local evidence_sha256
      evidence_sha256="$(option evidence-sha256)"
      require_hex "$evidence_sha256" 64
      command_args=(--verify-maintenance --database-url-file /run/secrets/operator-database-url \
        --cutover-id "$cutover_id" --evidence-sha256 "$evidence_sha256")
      output="$("${RUNTIME[@]}" "${database_mount[@]}" "$API_IMAGE" \
        /app/scripts/ai-content-cutover-control.mjs "${command_args[@]}")" ||
        fail "ai_content_cutover_verify_maintenance_failed"
      grep -q '"status":"maintenance_verified"' <<<"$output" || fail "ai_content_cutover_maintenance_evidence_invalid"
      ;;
    --abort-pre-marker)
      require_active_cutover "$cutover_id"
      local from_status evidence_sha256
      from_status="$(option from-status)"
      evidence_sha256="$(option evidence-sha256)"
      [[ "$from_status" == "prepared" || "$from_status" == "maintenance_verified" ]] ||
        fail "ai_content_cutover_abort_from_status_invalid"
      require_hex "$evidence_sha256" 64
      command_args=(--abort-pre-marker --database-url-file /run/secrets/operator-database-url \
        --cutover-id "$cutover_id" --from-status "$from_status" --evidence-sha256 "$evidence_sha256")
      output="$("${RUNTIME[@]}" "${database_mount[@]}" "$API_IMAGE" \
        /app/scripts/ai-content-cutover-control.mjs "${command_args[@]}")" ||
        fail "ai_content_cutover_abort_failed"
      grep -q '"status":"abandoned_pre_marker"' <<<"$output" || fail "ai_content_cutover_abort_evidence_invalid"
      grep -q '"markerPresent":false' <<<"$output" || fail "ai_content_cutover_abort_evidence_invalid"
      grep -q '"maintenanceEnabled":false' <<<"$output" || fail "ai_content_cutover_abort_evidence_invalid"
      clear_active_cutover=true
      ;;
    --status)
      require_active_cutover "$cutover_id"
      command_args=(--status --database-url-file /run/secrets/operator-database-url --cutover-id "$cutover_id")
      output="$("${RUNTIME[@]}" "${database_mount[@]}" "$API_IMAGE" \
        /app/scripts/ai-content-cutover-control.mjs "${command_args[@]}")" ||
        fail "ai_content_cutover_status_failed"
      grep -q "\"cutoverId\":\"$cutover_id\"" <<<"$output" || fail "ai_content_cutover_status_evidence_invalid"
      ;;
    *) fail "ai_content_cutover_control_mode_invalid" ;;
  esac
  capture_evidence "$output_file" printf '%s' "$output"
  if [[ "$clear_active_cutover" == "true" ]]; then
    remove_staged_release_pointer
    remove_state_file "$ROOT/state/ai-content-cutover-id"
  fi
}

copy_durable_evidence() {
  local source_file="$1"
  local output_file="$2"
  local mismatch_error="$3"
  require_file_mode_600 "$source_file" "$FILE_OWNER"
  [[ "$output_file" =~ ^/[a-zA-Z0-9._/-]+$ && ! -L "$output_file" ]] || fail "$mismatch_error"
  [[ -d "$(dirname -- "$output_file")" && ! -L "$(dirname -- "$output_file")" ]] || fail "$mismatch_error"
  if [[ -e "$output_file" ]]; then
    [[ -f "$output_file" ]] || fail "$mismatch_error"
    require_file_mode_600 "$output_file" "$FILE_OWNER"
    cmp -s "$source_file" "$output_file" || fail "$mismatch_error"
  else
    atomic_write "$output_file" "$(<"$source_file")"$'\n' 600
  fi
}

POST_075_STATE_PARENT=""
load_post_075_state_parent() {
  local cutover_id="$1"
  POST_075_STATE_PARENT="$ROOT/state/ai-content-cutovers/$cutover_id/finalize-post-075"
  install -d -m 0700 "$ROOT/state/ai-content-cutovers" \
    "$ROOT/state/ai-content-cutovers/$cutover_id"
  [[ -d "$ROOT/state/ai-content-cutovers" && ! -L "$ROOT/state/ai-content-cutovers" \
    && -d "$ROOT/state/ai-content-cutovers/$cutover_id" \
    && ! -L "$ROOT/state/ai-content-cutovers/$cutover_id" ]] ||
    fail "ai_content_cutover_post_075_state_invalid"
  if [[ ! -e "$POST_075_STATE_PARENT" && ! -L "$POST_075_STATE_PARENT" ]]; then
    install -d -m 0700 "$POST_075_STATE_PARENT"
  fi
  [[ -d "$POST_075_STATE_PARENT" && ! -L "$POST_075_STATE_PARENT" ]] ||
    fail "ai_content_cutover_post_075_state_invalid"
}

run_restore_shared_owners() {
  load_runtime_release
  load_runtime
  local admin_file plan_file cutover_id output_file restore_directory restore_evidence
  local -a admin_mount=() plan_mount=()
  admin_file="$(option admin-url-file)"
  plan_file="$(option plan-file)"
  cutover_id="$(option cutover-id)"
  output_file="$(option output)"
  require_secure_input "$admin_file"
  require_secure_input "$plan_file"
  require_uuid "$cutover_id"
  require_active_cutover "$cutover_id"
  mapfile -d '' -t admin_mount < <(mount_readonly "$admin_file" /run/input/admin-database-url)
  mapfile -d '' -t plan_mount < <(mount_readonly "$plan_file" /run/input/role-plan.json)
  load_post_075_state_parent "$cutover_id"

  restore_directory="$POST_075_STATE_PARENT/shared-owner-restore"
  restore_evidence="$restore_directory/evidence.json"
  if [[ -e "$restore_directory" || -L "$restore_directory" ]]; then
    [[ -d "$restore_directory" && ! -L "$restore_directory" ]] ||
      fail "ai_content_shared_owner_restore_state_incomplete"
  else
    install -d -m 0700 "$restore_directory"
  fi
  if [[ -e "$restore_evidence" || -L "$restore_evidence" ]]; then
    [[ -f "$restore_evidence" && ! -L "$restore_evidence" ]] ||
      fail "ai_content_shared_owner_restore_state_incomplete"
  else
    "${RUNTIME[@]}" "${admin_mount[@]}" "${plan_mount[@]}" \
      --mount "type=bind,src=$restore_directory,dst=/run/output" \
      "$API_IMAGE" /app/scripts/ai-content-database-roles.mjs --restore-shared-owners \
      --admin-url-file /run/input/admin-database-url --plan /run/input/role-plan.json \
      --evidence /run/output/evidence.json >/dev/null || fail "ai_content_shared_owner_restore_failed"
  fi
  require_file_mode_600 "$restore_evidence" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-shared-owner-restore-evidence.v1"' "$restore_evidence" ||
    fail "ai_content_shared_owner_restore_evidence_invalid"
  copy_durable_evidence "$restore_evidence" "$output_file" \
    "ai_content_shared_owner_restore_output_mismatch"
}

run_verify_backend() {
  load_runtime_release
  load_runtime
  local operator_file backend_input cutover_id output_file restore_evidence restore_sha256
  local backend_directory backend_evidence backend_output image_key
  local -a operator_mount=() backend_mount=()
  operator_file="$(option operator-url-file)"
  backend_input="$(option backend-evidence-file)"
  cutover_id="$(option cutover-id)"
  output_file="$(option output)"
  require_secure_input "$operator_file"
  require_secure_input "$backend_input"
  require_uuid "$cutover_id"
  require_active_cutover "$cutover_id"
  load_post_075_state_parent "$cutover_id"
  restore_evidence="$POST_075_STATE_PARENT/shared-owner-restore/evidence.json"
  require_file_mode_600 "$restore_evidence" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-shared-owner-restore-evidence.v1"' "$restore_evidence" ||
    fail "ai_content_shared_owner_restore_evidence_invalid"
  restore_sha256="$(sha256sum "$restore_evidence")"
  restore_sha256="${restore_sha256%% *}"
  require_hex "$restore_sha256" 64
  for image_key in CONTENT_PROPOSAL_WORKER_IMAGE IMAGE_WORKER_IMAGE \
    CARD_NEWS_WORKER_IMAGE BLOG_WORKER_IMAGE REEL_WORKER_IMAGE; do
    require_digest_image "${RELEASE_MANIFEST[$image_key]}"
    verify_release_image_revision "${RELEASE_MANIFEST[$image_key]}" \
      "$(release_image_source_revision "$image_key")"
  done
  mapfile -d '' -t operator_mount < <(mount_readonly "$operator_file" /run/input/operator-database-url)
  mapfile -d '' -t backend_mount < <(mount_readonly "$backend_input" /run/input/backend-evidence.json)
  backend_output="$("${RUNTIME[@]}" "${operator_mount[@]}" "${backend_mount[@]}" "$API_IMAGE" \
    /app/scripts/ai-content-cutover-control.mjs --verify-backend \
    --database-url-file /run/input/operator-database-url --cutover-id "$cutover_id" \
    --evidence-file /run/input/backend-evidence.json --candidate-release-sha "$RELEASE_SHA" \
    --shared-owner-restore-evidence-sha256 "$restore_sha256" \
    --api-image-digest "${API_IMAGE##*@}" \
    --content-proposal-worker-image-digest "${RELEASE_MANIFEST[CONTENT_PROPOSAL_WORKER_IMAGE]##*@}" \
    --image-worker-image-digest "${RELEASE_MANIFEST[IMAGE_WORKER_IMAGE]##*@}" \
    --card-news-worker-image-digest "${RELEASE_MANIFEST[CARD_NEWS_WORKER_IMAGE]##*@}" \
    --blog-worker-image-digest "${RELEASE_MANIFEST[BLOG_WORKER_IMAGE]##*@}" \
    --reel-worker-image-digest "${RELEASE_MANIFEST[REEL_WORKER_IMAGE]##*@}")" ||
    fail "ai_content_cutover_backend_verification_failed"
  grep -q "\"cutoverId\":\"$cutover_id\"" <<<"$backend_output" ||
    fail "ai_content_cutover_backend_evidence_invalid"
  grep -q '"status":"backend_verified"' <<<"$backend_output" ||
    fail "ai_content_cutover_backend_evidence_invalid"
  grep -q '"maintenanceEnabled":true' <<<"$backend_output" ||
    fail "ai_content_cutover_backend_evidence_invalid"
  backend_directory="$POST_075_STATE_PARENT/backend-verified"
  backend_evidence="$backend_directory/evidence.json"
  if [[ ! -e "$backend_directory" && ! -L "$backend_directory" ]]; then
    install -d -m 0700 "$backend_directory"
  fi
  [[ -d "$backend_directory" && ! -L "$backend_directory" ]] ||
    fail "ai_content_cutover_backend_state_invalid"
  if [[ -e "$backend_evidence" || -L "$backend_evidence" ]]; then
    [[ -f "$backend_evidence" && ! -L "$backend_evidence" ]] ||
      fail "ai_content_cutover_backend_state_invalid"
    require_file_mode_600 "$backend_evidence" "$FILE_OWNER"
    [[ "$(<"$backend_evidence")" == "$backend_output" ]] ||
      fail "ai_content_cutover_backend_output_mismatch"
  else
    atomic_write "$backend_evidence" "${backend_output}"$'\n' 600
  fi
  copy_durable_evidence "$backend_evidence" "$output_file" \
    "ai_content_cutover_backend_output_mismatch"
}

run_complete_cutover() {
  load_runtime_release
  load_runtime
  local admin_file operator_file plan_file cutover_id output_file backend_evidence
  local retirement_directory retirement_evidence completion_directory completion_evidence completion_output
  local -a admin_mount=() operator_mount=() plan_mount=() retirement_mount=()
  admin_file="$(option admin-url-file)"
  operator_file="$(option operator-url-file)"
  plan_file="$(option plan-file)"
  cutover_id="$(option cutover-id)"
  output_file="$(option output)"
  require_secure_input "$admin_file"
  require_secure_input "$operator_file"
  require_secure_input "$plan_file"
  require_uuid "$cutover_id"
  require_active_cutover "$cutover_id"
  load_post_075_state_parent "$cutover_id"
  backend_evidence="$POST_075_STATE_PARENT/backend-verified/evidence.json"
  require_file_mode_600 "$backend_evidence" "$FILE_OWNER"
  grep -q "\"cutoverId\":\"$cutover_id\"" "$backend_evidence" ||
    fail "ai_content_cutover_backend_evidence_invalid"
  grep -q '"status":"backend_verified"' "$backend_evidence" ||
    fail "ai_content_cutover_backend_evidence_invalid"
  mapfile -d '' -t admin_mount < <(mount_readonly "$admin_file" /run/input/admin-database-url)
  mapfile -d '' -t operator_mount < <(mount_readonly "$operator_file" /run/input/operator-database-url)
  mapfile -d '' -t plan_mount < <(mount_readonly "$plan_file" /run/input/role-plan.json)

  retirement_directory="$POST_075_STATE_PARENT/cleanup-role-retirement"
  retirement_evidence="$retirement_directory/evidence.json"
  if [[ -e "$retirement_directory" || -L "$retirement_directory" ]]; then
    [[ -d "$retirement_directory" && ! -L "$retirement_directory" ]] ||
      fail "ai_content_cleanup_role_retirement_state_incomplete"
  else
    install -d -m 0700 "$retirement_directory"
  fi
  if [[ -e "$retirement_evidence" || -L "$retirement_evidence" ]]; then
    [[ -f "$retirement_evidence" && ! -L "$retirement_evidence" ]] ||
      fail "ai_content_cleanup_role_retirement_state_incomplete"
  else
    "${RUNTIME[@]}" "${admin_mount[@]}" "${plan_mount[@]}" \
      --mount "type=bind,src=$retirement_directory,dst=/run/output" \
      "$API_IMAGE" /app/scripts/ai-content-database-roles.mjs --retire-cleanup-role \
      --admin-url-file /run/input/admin-database-url --plan /run/input/role-plan.json \
      --cutover-id "$cutover_id" --evidence /run/output/evidence.json >/dev/null ||
      fail "ai_content_cleanup_role_retirement_failed"
  fi
  require_file_mode_600 "$retirement_evidence" "$FILE_OWNER"
  grep -q '"contractVersion":"ai-content-cleanup-role-retirement-evidence.v1"' "$retirement_evidence" ||
    fail "ai_content_cleanup_role_retirement_evidence_invalid"
  mapfile -d '' -t retirement_mount < <(mount_readonly "$retirement_evidence" /run/input/cleanup-retirement-evidence.json)

  completion_directory="$POST_075_STATE_PARENT/completed"
  completion_evidence="$completion_directory/evidence.json"
  if [[ ! -e "$completion_directory" && ! -L "$completion_directory" ]]; then
    install -d -m 0700 "$completion_directory"
  fi
  [[ -d "$completion_directory" && ! -L "$completion_directory" ]] ||
    fail "ai_content_cutover_completion_state_invalid"
  completion_output="$("${RUNTIME[@]}" "${operator_mount[@]}" "${retirement_mount[@]}" \
    "$API_IMAGE" /app/scripts/ai-content-cutover-control.mjs --complete \
    --database-url-file /run/input/operator-database-url --cutover-id "$cutover_id" \
    --cleanup-revocation-evidence-file /run/input/cleanup-retirement-evidence.json)" ||
    fail "ai_content_cutover_completion_failed"
  grep -q "\"cutoverId\":\"$cutover_id\"" <<<"$completion_output" ||
    fail "ai_content_cutover_completion_evidence_invalid"
  grep -q '"status":"completed"' <<<"$completion_output" ||
    fail "ai_content_cutover_completion_evidence_invalid"
  grep -q '"markerPresent":true' <<<"$completion_output" ||
    fail "ai_content_cutover_completion_evidence_invalid"
  grep -q '"maintenanceEnabled":false' <<<"$completion_output" ||
    fail "ai_content_cutover_completion_evidence_invalid"
  if [[ -e "$completion_evidence" || -L "$completion_evidence" ]]; then
    [[ -f "$completion_evidence" && ! -L "$completion_evidence" ]] ||
      fail "ai_content_cutover_completion_state_invalid"
    require_file_mode_600 "$completion_evidence" "$FILE_OWNER"
    [[ "$(<"$completion_evidence")" == "$completion_output" ]] ||
      fail "ai_content_cutover_completion_output_mismatch"
  else
    atomic_write "$completion_evidence" "${completion_output}"$'\n' 600
  fi
  require_file_mode_600 "$completion_evidence" "$FILE_OWNER"
  grep -q '"status":"completed"' "$completion_evidence" ||
    fail "ai_content_cutover_completion_evidence_invalid"
  grep -q '"maintenanceEnabled":false' "$completion_evidence" ||
    fail "ai_content_cutover_completion_evidence_invalid"
  copy_durable_evidence "$completion_evidence" "$output_file" \
    "ai_content_cutover_completion_output_mismatch"
  remove_staged_release_pointer
  remove_state_file "$ROOT/state/ai-content-cutover-id"
}

for command_name in cmp docker flock id install mktemp readlink sed sha256sum sync wc; do
  require_command "$command_name"
done
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"

case "$MODE" in
  --initialize-provider-artifacts) run_initialize_provider_artifacts ;;
  --verify-and-authorize-074) run_verify_and_authorize_074 ;;
  --install-074-enforcement-bundle) run_install_074_enforcement_bundle ;;
  --install-075-ddl-allowlist) run_install_075_ddl_allowlist ;;
  --collect-prepare-inputs) run_collect_prepare_inputs ;;
  --create-prepare-evidence) run_create_prepare_evidence ;;
  --apply-073a) run_073a ;;
  --plan-role-bootstrap) run_role_plan ;;
  --apply-role-bootstrap) run_role_bootstrap ;;
  --run-proposal-preflight) run_proposal_preflight ;;
  --apply-074-stage) run_074 false ;;
  --consume-074-attestation) run_074 true ;;
  --prepare) run_control --prepare ;;
  --enable-maintenance) run_control --enable-maintenance ;;
  --verify-maintenance) run_control --verify-maintenance ;;
  --abort-pre-marker) run_control --abort-pre-marker ;;
  --status) run_control --status ;;
  --execute-075) run_075 ;;
  --restore-shared-owners) run_restore_shared_owners ;;
  --verify-backend) run_verify_backend ;;
  --complete) run_complete_cutover ;;
  *) fail "ai_content_cutover_mode_invalid" ;;
esac

status_ok "ai_content_cutover"
