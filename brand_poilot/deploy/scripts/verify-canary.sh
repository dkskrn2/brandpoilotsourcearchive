#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

[[ $# -eq 2 ]] || fail "usage_verify_canary_base_url_allowed_origin"
BASE_URL="${1%/}"
ALLOWED_ORIGIN="$2"
[[ "$BASE_URL" =~ ^https://[a-z0-9.-]+$ ]] || fail "canary_url_invalid"
[[ "$ALLOWED_ORIGIN" =~ ^https://[a-z0-9.-]+$ ]] || fail "allowed_origin_invalid"
EVIL_ORIGIN="https://not-allowed.invalid"
REQUEST_TIMEOUT_SECONDS=15
TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT

wait_for_url "$BASE_URL/health" 120 || fail "canary_health_failed"
wait_for_url "$BASE_URL/ready" 120 || fail "canary_readiness_failed"
status_ok "health"
status_ok "readiness"

request_headers() {
  local origin="$1"
  local output="$2"
  curl --silent --show-error --fail \
    --connect-timeout 5 --max-time "$REQUEST_TIMEOUT_SECONDS" \
    --header "Origin: $origin" \
    --dump-header "$output" --output /dev/null -- "$BASE_URL/health"
}

request_headers "$ALLOWED_ORIGIN" "$TMP_DIR/allowed.headers"
grep -Eiq "^access-control-allow-origin:[[:space:]]*${ALLOWED_ORIGIN//./\\.}\r?$" \
  "$TMP_DIR/allowed.headers" || fail "canary_cors_allowed_origin_missing"
status_ok "cors_allowed"

request_headers "$EVIL_ORIGIN" "$TMP_DIR/evil.headers"
if grep -Eiq '^access-control-allow-origin:' "$TMP_DIR/evil.headers"; then
  fail "canary_cors_evil_origin_allowed"
fi
status_ok "cors_denied"

DEV_STATUS="$(curl --silent --show-error \
  --connect-timeout 5 --max-time "$REQUEST_TIMEOUT_SECONDS" \
  --output /dev/null --write-out '%{http_code}' \
  -- "$BASE_URL/auth/meta/dev-complete")"
[[ "$DEV_STATUS" == "404" ]] || fail "canary_dev_route_exposed"
status_ok "dev_route"
