#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

fail() {
  printf 'bootstrap_error:%s\n' "$1" >&2
  exit 1
}

[[ "$EUID" -eq 0 ]] || fail "root_required"
[[ -r /etc/os-release ]] || fail "os_release_missing"
# shellcheck source=/etc/os-release
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] ||
  fail "ubuntu_24_04_required"
[[ "$(dpkg --print-architecture)" == "amd64" ]] ||
  fail "amd64_required"
id -u bpdeploy >/dev/null 2>&1 || fail "bpdeploy_user_required"

ROOT="/opt/brand-pilot"
[[ "$(realpath -m -- "$ROOT")" == "$ROOT" ]] ||
  fail "root_path_invalid"

managed_paths=(
  "$ROOT"
  "$ROOT/repo"
  "$ROOT/incoming"
  "$ROOT/releases"
  "$ROOT/state"
  "$ROOT/shared"
  "$ROOT/shared/env"
  "$ROOT/shared/codex"
  "$ROOT/shared/codex-accounts"
  "$ROOT/shared/codex-accounts/primary"
  "$ROOT/shared/codex-accounts/secondary"
  "$ROOT/shared/codex-accounts/primary/generated_images"
  "$ROOT/shared/codex-accounts/secondary/generated_images"
)

for path in "${managed_paths[@]}"; do
  [[ ! -L "$path" ]] || fail "managed_path_symlink_forbidden"
  [[ ! -e "$path" || -d "$path" ]] || fail "managed_path_not_directory"
  [[ "$(realpath -m -- "$path")" == "$path" ]] ||
    fail "managed_path_escape"
done

install -d -m 0750 -o bpdeploy -g bpdeploy "$ROOT"
install -d -m 0750 -o bpdeploy -g bpdeploy "$ROOT/repo"
install -d -m 0750 -o bpdeploy -g bpdeploy "$ROOT/incoming"
install -d -m 0750 -o bpdeploy -g bpdeploy "$ROOT/releases"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/state"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/shared"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/shared/env"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/shared/codex"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/shared/codex-accounts"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/shared/codex-accounts/primary"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/shared/codex-accounts/secondary"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/shared/codex-accounts/primary/generated_images"
install -d -m 0700 -o bpdeploy -g bpdeploy "$ROOT/shared/codex-accounts/secondary/generated_images"

printf 'bootstrap_ok:%s\n' "$ROOT"
