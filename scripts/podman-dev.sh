#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly POD_NAME="page-2-code-dev"
readonly API_IMAGE="page-2-code-api-dev"
readonly MCP_IMAGE="page-2-code-mcp-dev"
readonly WEB_IMAGE="page-2-code-web-dev"
readonly API_CONTAINER="page-2-code-api"
readonly MCP_CONTAINER="page-2-code-mcp"
readonly WEB_CONTAINER="page-2-code-web"
readonly POSTGRES_CONTAINER="page-2-code-postgres"
readonly POSTGRES_DATABASE="page_2_code"
readonly POSTGRES_USER="page_2_code"
readonly POSTGRES_PASSWORD="page_2_code_dev"

start_pod() {
  podman build --tag "${API_IMAGE}" "${PROJECT_ROOT}/api"
  podman build --tag "${MCP_IMAGE}" "${PROJECT_ROOT}/mcp"
  podman build --tag "${WEB_IMAGE}" "${PROJECT_ROOT}/web"

  if podman pod exists "${POD_NAME}"; then
    podman pod rm --force "${POD_NAME}"
  fi

  podman pod create \
    --name "${POD_NAME}" \
    --publish 3000:3000 \
    --publish 3002:3002 \
    --publish 8081:8081

  podman run --detach \
    --name "${POSTGRES_CONTAINER}" \
    --pod "${POD_NAME}" \
    --env "POSTGRES_DB=${POSTGRES_DATABASE}" \
    --env "POSTGRES_USER=${POSTGRES_USER}" \
    --env "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
    --volume "page-2-code-postgres-data:/var/lib/postgresql/data:Z" \
    postgres:latest

  podman run --detach \
    --name "${API_CONTAINER}" \
    --pod "${POD_NAME}" \
    --volume "${PROJECT_ROOT}:/app:Z" \
    "${API_IMAGE}"

  podman run --detach \
    --name "${MCP_CONTAINER}" \
    --pod "${POD_NAME}" \
    --volume "${PROJECT_ROOT}:/app:Z" \
    "${MCP_IMAGE}"

  podman run --detach \
    --name "${WEB_CONTAINER}" \
    --pod "${POD_NAME}" \
    --volume "${PROJECT_ROOT}:/app:Z" \
    "${WEB_IMAGE}"
}

stop_pod() {
  if podman pod exists "${POD_NAME}"; then
    podman pod rm --force "${POD_NAME}"
  fi
}

case "${1:-up}" in
  up)
    start_pod
    ;;
  down)
    stop_pod
    ;;
  *)
    printf 'Usage: %s {up|down}\n' "$0" >&2
    exit 1
    ;;
esac
