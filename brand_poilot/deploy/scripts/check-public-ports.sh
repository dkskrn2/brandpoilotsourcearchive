#!/usr/bin/env bash

validate_public_port_ownership() {
  local listeners="$1"
  local docker_rows="$2"
  local listener
  local row_count=0
  local container_id container_name project service ports extra
  local mapping
  local published_count

  [[ -n "$listeners" ]] || return 0

  if [[ "$listeners" == *"users:("* ]]; then
    while IFS= read -r listener; do
      [[ -z "$listener" ]] && continue
      [[ "$listener" == *"docker-proxy"* ]] || return 1
    done <<< "$listeners"
  else
    while IFS= read -r listener; do
      [[ -z "$listener" ]] && continue
      [[ "$listener" != *"users:("* ]] || return 1
    done <<< "$listeners"
  fi

  while IFS='|' read -r container_id container_name project service ports extra; do
    [[ -z "$container_id" ]] && continue
    ((row_count += 1))
    [[ -z "$extra" ]] || return 1
    [[ "$project" == "brand-pilot" && "$service" == "caddy" ]] || return 1
    [[ "$container_name" == "brand-pilot-caddy-1" ]] || return 1
    published_count=0
    while IFS= read -r mapping; do
      mapping="${mapping#"${mapping%%[![:space:]]*}"}"
      [[ "$mapping" == *"->"* ]] || continue
      ((published_count += 1))
      case "$mapping" in
        "0.0.0.0:80->80/tcp"|"[::]:80->80/tcp"|"0.0.0.0:443->443/tcp"|"[::]:443->443/tcp") ;;
        *) return 1 ;;
      esac
    done < <(printf '%s\n' "$ports" | tr ',' '\n')
    [[ "$published_count" == "4" ]] || return 1
    for mapping in \
      "0.0.0.0:80->80/tcp" \
      "[::]:80->80/tcp" \
      "0.0.0.0:443->443/tcp" \
      "[::]:443->443/tcp"; do
      [[ ", $ports," == *", $mapping,"* || ",$ports," == *",$mapping,"* ]] || return 1
    done
  done <<< "$docker_rows"

  [[ "$row_count" == "1" ]]
}
