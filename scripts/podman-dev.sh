#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly COMPOSE_FILE="${PROJECT_ROOT}/compose.yaml"

compose() {
  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    printf 'Missing %s. Create it from the repository compose template before running the stack.\n' "${COMPOSE_FILE}" >&2
    exit 1
  fi

  if podman compose version >/dev/null 2>&1; then
    podman compose --file "${COMPOSE_FILE}" "$@"
    return
  fi

  if command -v podman-compose >/dev/null 2>&1; then
    podman-compose --file "${COMPOSE_FILE}" "$@"
    return
  fi

  printf 'No compose provider found. Install podman-compose or use a podman build that ships "podman compose".\n' >&2
  exit 1
}

case "${1:-up}" in
  up)
    compose up --detach --build
    ;;
  down)
    compose down
    ;;
  logs)
    compose logs --follow
    ;;
  ps)
    compose ps
    ;;
  *)
    printf 'Usage: %s {up|down|logs|ps}\n' "$0" >&2
    exit 1
    ;;
esac
