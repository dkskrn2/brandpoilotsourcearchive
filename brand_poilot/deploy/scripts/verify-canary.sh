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
CANARY_SESSION_COOKIE_FILE="${CANARY_SESSION_COOKIE_FILE:-}"
CANARY_BRAND_ID="${CANARY_BRAND_ID:-}"

for command_name in curl grep jq mktemp; do
  require_command "$command_name"
done
[[ -n "$CANARY_SESSION_COOKIE_FILE" ]] || fail "canary_session_cookie_file_required"
require_file_mode_600 "$CANARY_SESSION_COOKIE_FILE"
[[ "$CANARY_BRAND_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "canary_brand_id_invalid"

wait_for_url "$BASE_URL/health" 120 || fail "canary_health_failed"
curl --silent --show-error --fail \
  --connect-timeout 5 --max-time "$REQUEST_TIMEOUT_SECONDS" \
  --output "$TMP_DIR/ready.json" -- "$BASE_URL/ready" ||
  fail "canary_readiness_failed"
jq -e '
  .ok == true
  and .database == "ok"
  and .features.scheduler == "disabled"
  and .features.publishing == "enabled"
  and .features.dm == "disabled"
' "$TMP_DIR/ready.json" >/dev/null || fail "canary_safe_flags_invalid"
status_ok "health"
status_ok "readiness"
status_ok "db_read"
status_ok "safe_flags"

request_headers() {
  local origin="$1"
  local output="$2"
  curl --silent --show-error --fail \
    --connect-timeout 5 --max-time "$REQUEST_TIMEOUT_SECONDS" \
    --header "Origin: $origin" \
    --dump-header "$output" --output /dev/null -- "$BASE_URL/health"
}

request_headers "$ALLOWED_ORIGIN" "$TMP_DIR/allowed.headers"
tr -d '\r' < "$TMP_DIR/allowed.headers" \
  | grep -Eiq "^access-control-allow-origin:[[:space:]]*${ALLOWED_ORIGIN//./\\.}$" \
  || fail "canary_cors_allowed_origin_missing"
status_ok "cors_allowed"

request_headers "$EVIL_ORIGIN" "$TMP_DIR/evil.headers"
if grep -Eiq '^access-control-allow-origin:' "$TMP_DIR/evil.headers"; then
  fail "canary_cors_evil_origin_allowed"
fi
status_ok "cors_denied"

curl --silent --show-error --fail \
  --connect-timeout 5 --max-time "$REQUEST_TIMEOUT_SECONDS" \
  --dump-header "$TMP_DIR/login.headers" --output /dev/null \
  -- "$BASE_URL/auth/kakao/login"
grep -Eiq '^set-cookie:.*Secure' "$TMP_DIR/login.headers" ||
  fail "canary_secure_cookie_missing"
grep -Eiq '^set-cookie:.*HttpOnly' "$TMP_DIR/login.headers" ||
  fail "canary_http_only_cookie_missing"
grep -Eiq '^set-cookie:.*SameSite=Lax' "$TMP_DIR/login.headers" ||
  fail "canary_same_site_cookie_missing"
status_ok "secure_cookie"

DEV_STATUS="$(curl --silent --show-error \
  --connect-timeout 5 --max-time "$REQUEST_TIMEOUT_SECONDS" \
  --output /dev/null --write-out '%{http_code}' \
  -- "$BASE_URL/auth/meta/dev-complete")"
[[ "$DEV_STATUS" == "404" ]] || fail "canary_dev_route_exposed"
status_ok "dev_route"

readonly_get() {
  local path="$1"
  local label="$2"
  curl --silent --show-error --fail \
    --connect-timeout 5 --max-time "$REQUEST_TIMEOUT_SECONDS" \
    --cookie "$CANARY_SESSION_COOKIE_FILE" \
    --output "$TMP_DIR/${label}.json" -- "$BASE_URL$path" ||
    fail "canary_${label}_read_failed"
  jq -e 'type == "object" or type == "array"' "$TMP_DIR/${label}.json" >/dev/null ||
    fail "canary_${label}_response_invalid"
  status_ok "$label"
}

readonly_get "/auth/me" "authenticated_session"
readonly_get "/brands/$CANARY_BRAND_ID/brand-core" "brand_core"
readonly_get "/brands/$CANARY_BRAND_ID/product-services" "product_services"
readonly_get "/brands/$CANARY_BRAND_ID/wiki/status" "wiki"
readonly_get "/brands/$CANARY_BRAND_ID/ai-content/usage" "generation_usage"
readonly_get "/brands/$CANARY_BRAND_ID/channels/capabilities" "channel_capabilities"
jq -e '
  (map(select(.channel == "instagram"))) as $instagram
  | ($instagram | length) == 1
    and $instagram[0].enabled == true
    and $instagram[0].connectionStatus == "connected"
    and $instagram[0].readiness == "ready"
    and $instagram[0].reasonCode == null
    and (($instagram[0].generationFormats | index("card_news")) != null)
    and (($instagram[0].publishModes | index("instagram_feed_single")) != null)
    and (($instagram[0].publishModes | index("instagram_feed_carousel")) != null)
' "$TMP_DIR/channel_capabilities.json" >/dev/null ||
  fail "canary_instagram_capability_invalid"
status_ok "instagram_capability"
