#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ROOT="${BRAND_PILOT_ROOT:-/opt/brand-pilot}"
[[ $# -eq 1 ]] || fail "usage_rollout_workers_release_directory"
RELEASE_DIR="$(cd -- "$1" && pwd)"

for command_name in docker flock grep; do
  require_command "$command_name"
done

mkdir -p -- "$ROOT/state"
exec 9>"$ROOT/state/deploy.lock"
flock -n 9 || fail "deploy_lock_busy"
reconcile_transition_or_fail "$ROOT" "${READY_TIMEOUT_SECONDS:-120}"

validate_release_directory "$RELEASE_DIR"
require_worker_image_manifest
RELEASE_SHA="${RELEASE_MANIFEST[RELEASE_SHA]}"

CURRENT_SHA=""
load_required_state_sha "$ROOT/state/current" CURRENT_SHA
[[ "$CURRENT_SHA" == "$RELEASE_SHA" ]] || fail "worker_rollout_current_release_mismatch"

declare -A SERVICES_BY_IMAGE=(
  [DM_WORKER_IMAGE]="dm-worker-1 dm-worker-2"
  [WIKI_WORKER_IMAGE]="wiki-worker-1"
  [CONTENT_PROPOSAL_WORKER_IMAGE]="content-proposal-worker-1"
  [BRAND_INTELLIGENCE_WORKER_IMAGE]="brand-intelligence-worker-1"
  [SUBJECT_ANALYSIS_WORKER_IMAGE]="subject-analysis-worker-1"
  [IMAGE_WORKER_IMAGE]="image-worker-1"
  [CARD_NEWS_WORKER_IMAGE]="card-news-worker-1"
  [BLOG_WORKER_IMAGE]="blog-worker-1"
  [MARKETING_WORKER_IMAGE]="marketing-worker-1"
)
declare -A IMAGE_BY_SERVICE=(
  [dm-worker-1]="DM_WORKER_IMAGE"
  [dm-worker-2]="DM_WORKER_IMAGE"
  [wiki-worker-1]="WIKI_WORKER_IMAGE"
  [content-proposal-worker-1]="CONTENT_PROPOSAL_WORKER_IMAGE"
  [brand-intelligence-worker-1]="BRAND_INTELLIGENCE_WORKER_IMAGE"
  [subject-analysis-worker-1]="SUBJECT_ANALYSIS_WORKER_IMAGE"
  [image-worker-1]="IMAGE_WORKER_IMAGE"
  [card-news-worker-1]="CARD_NEWS_WORKER_IMAGE"
  [blog-worker-1]="BLOG_WORKER_IMAGE"
  [marketing-worker-1]="MARKETING_WORKER_IMAGE"
)
declare -A CANDIDATE_IMAGES=()
declare -a CHANGED_IMAGE_KEYS=()
declare -a CHANGED_SERVICES=()

for image_key in "${WORKER_IMAGE_KEYS[@]}"; do
  CANDIDATE_IMAGES["$image_key"]="${RELEASE_MANIFEST[$image_key]}"
  if release_image_changed "$image_key"; then
    CHANGED_IMAGE_KEYS+=("$image_key")
    read -r -a mapped_services <<<"${SERVICES_BY_IMAGE[$image_key]}"
    CHANGED_SERVICES+=("${mapped_services[@]}")
  fi
done

if [[ ${#CHANGED_SERVICES[@]} -eq 0 ]]; then
  printf '%s\n' "worker_rollout=skipped"
  exit 0
fi

PREVIOUS_SHA=""
load_required_state_sha "$ROOT/state/previous" PREVIOUS_SHA
[[ "$PREVIOUS_SHA" != "$RELEASE_SHA" ]] || fail "worker_rollout_previous_release_invalid"
PREVIOUS_DIR="$ROOT/releases/$PREVIOUS_SHA"
validate_release_directory "$PREVIOUS_DIR"
require_worker_image_manifest

declare -A PREVIOUS_IMAGES=()
for image_key in "${WORKER_IMAGE_KEYS[@]}"; do
  PREVIOUS_IMAGES["$image_key"]="${RELEASE_MANIFEST[$image_key]}"
done

export_release_images() {
  local source_name="$1"
  local -n source_images="$source_name"
  export DM_WORKER_IMAGE="${source_images[DM_WORKER_IMAGE]}"
  export WIKI_WORKER_IMAGE="${source_images[WIKI_WORKER_IMAGE]}"
  export CONTENT_PROPOSAL_WORKER_IMAGE="${source_images[CONTENT_PROPOSAL_WORKER_IMAGE]}"
  export BRAND_INTELLIGENCE_WORKER_IMAGE="${source_images[BRAND_INTELLIGENCE_WORKER_IMAGE]}"
  export SUBJECT_ANALYSIS_WORKER_IMAGE="${source_images[SUBJECT_ANALYSIS_WORKER_IMAGE]}"
  export IMAGE_WORKER_IMAGE="${source_images[IMAGE_WORKER_IMAGE]}"
  export CARD_NEWS_WORKER_IMAGE="${source_images[CARD_NEWS_WORKER_IMAGE]}"
  export BLOG_WORKER_IMAGE="${source_images[BLOG_WORKER_IMAGE]}"
  export MARKETING_WORKER_IMAGE="${source_images[MARKETING_WORKER_IMAGE]}"
}

declare -a ALL_CHANGED_PROFILE_ARGS=()
for service in "${CHANGED_SERVICES[@]}"; do
  ALL_CHANGED_PROFILE_ARGS+=(--profile "$service")
done

previous_compose_all=(docker compose -p brand-pilot -f "$PREVIOUS_DIR/compose.production.yml" --env-file "$PREVIOUS_DIR/release.env" "${ALL_CHANGED_PROFILE_ARGS[@]}")
export_release_images PREVIOUS_IMAGES
"${previous_compose_all[@]}" config --quiet >/dev/null
running_before="$("${previous_compose_all[@]}" ps --status running --services)"

declare -a ROLLOUT_SERVICES=()
declare -a ROLLOUT_IMAGE_KEYS=()
for image_key in "${CHANGED_IMAGE_KEYS[@]}"; do
  image_is_active=false
  read -r -a mapped_services <<<"${SERVICES_BY_IMAGE[$image_key]}"
  for service in "${mapped_services[@]}"; do
    if grep -Fx -- "$service" <<<"$running_before" >/dev/null; then
      ROLLOUT_SERVICES+=("$service")
      image_is_active=true
    fi
  done
  if [[ "$image_is_active" == "true" ]]; then
    ROLLOUT_IMAGE_KEYS+=("$image_key")
  fi
done

if [[ ${#ROLLOUT_SERVICES[@]} -eq 0 ]]; then
  printf '%s\n' "worker_rollout=skipped_inactive"
  exit 0
fi

# A manifest can be promoted even when its worker rollout is deferred. Refuse
# to use that manifest as a recovery target unless it matches the actual
# pre-rollout containers exactly.
for service in "${ROLLOUT_SERVICES[@]}"; do
  container_id="$("${previous_compose_all[@]}" ps -q "$service")"
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] || fail "worker_previous_runtime_mismatch"
  running_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")" ||
    fail "worker_previous_runtime_mismatch"
  image_key="${IMAGE_BY_SERVICE[$service]}"
  [[ "$running_image" == "${PREVIOUS_IMAGES[$image_key]}" ]] ||
    fail "worker_previous_runtime_mismatch"
done

HEARTBEAT_VERIFIER="${WORKER_HEARTBEAT_VERIFY_SCRIPT:-}"
[[ "$HEARTBEAT_VERIFIER" == /* && -f "$HEARTBEAT_VERIFIER" &&
  ! -L "$HEARTBEAT_VERIFIER" && -x "$HEARTBEAT_VERIFIER" ]] ||
  fail "worker_heartbeat_evidence_required"

declare -a PROFILE_ARGS=()
for service in "${ROLLOUT_SERVICES[@]}"; do
  PROFILE_ARGS+=(--profile "$service")
done

previous_compose=(docker compose -p brand-pilot -f "$PREVIOUS_DIR/compose.production.yml" --env-file "$PREVIOUS_DIR/release.env" "${PROFILE_ARGS[@]}")
candidate_compose=(docker compose -p brand-pilot -f "$RELEASE_DIR/compose.production.yml" --env-file "$RELEASE_DIR/release.env" "${PROFILE_ARGS[@]}")

# Pull and inspect the previous immutable images before mutation so recovery does
# not depend on a registry request after a failed rollout.
for image_key in "${ROLLOUT_IMAGE_KEYS[@]}"; do
  docker pull --quiet "${PREVIOUS_IMAGES[$image_key]}" >/dev/null || fail "worker_previous_image_pull_failed"
done
"${previous_compose[@]}" config --quiet >/dev/null

export_release_images CANDIDATE_IMAGES
for image_key in "${ROLLOUT_IMAGE_KEYS[@]}"; do
  docker pull --quiet "${CANDIDATE_IMAGES[$image_key]}" >/dev/null || fail "worker_image_pull_failed"
  validate_release_directory "$RELEASE_DIR"
  verify_release_image_revision \
    "${CANDIDATE_IMAGES[$image_key]}" \
    "$(release_image_source_revision "$image_key")"
done
"${candidate_compose[@]}" config --quiet >/dev/null

ROLLOUT_MUTATED=false
recover_previous_workers() {
  local exit_code="$?"
  trap - EXIT
  if [[ "$exit_code" -ne 0 && "$ROLLOUT_MUTATED" == "true" ]]; then
    export_release_images PREVIOUS_IMAGES
    "${previous_compose[@]}" up -d --no-deps --pull never --force-recreate "${ROLLOUT_SERVICES[@]}" ||
      printf '%s\n' "error=worker_previous_release_recovery_failed" >&2
  fi
  exit "$exit_code"
}
trap recover_previous_workers EXIT

ROLLOUT_MUTATED=true
"${candidate_compose[@]}" up -d --no-deps --pull never --force-recreate "${ROLLOUT_SERVICES[@]}"

running_services="$("${candidate_compose[@]}" ps --status running --services)"
for service in "${ROLLOUT_SERVICES[@]}"; do
  grep -Fx -- "$service" <<<"$running_services" >/dev/null || fail "worker_service_not_running"
done

"$HEARTBEAT_VERIFIER" "$RELEASE_SHA" "${ROLLOUT_SERVICES[@]}" ||
  fail "worker_heartbeat_verification_failed"

trap - EXIT
printf 'worker_rollout=ok\nrelease_sha=%s\n' "$RELEASE_SHA"
