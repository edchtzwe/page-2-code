#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly KEY_DIR="${REPO_ROOT}/keys"
readonly PRIVATE_KEY_FILE="${KEY_DIR}/jwt-private.pem"
readonly PUBLIC_KEY_FILE="${KEY_DIR}/jwt-public.pem"
readonly ALGORITHM="RS256"
readonly TOKEN_TYPE="JWT"
readonly KEY_BITS=4096
readonly DEFAULT_TTL_SECONDS=1296000
readonly KID_LENGTH=16
readonly KEY_DIR_MODE=700
readonly SECRET_FILE_MODE=600
readonly PUBLIC_FILE_MODE=644
readonly HOPS=("web:api" "api:mcp" "mcp:tools")

TTL_SECONDS=""
KEY_ID=""
ISSUED_AT=""
EXPIRES_AT=""

base64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

require_openssl() {
  if ! command -v openssl >/dev/null 2>&1; then
    printf 'openssl is required to rotate keys and tokens.\n' >&2
    exit 1
  fi
}

write_keypair() {
  mkdir -p "${KEY_DIR}"
  chmod "${KEY_DIR_MODE}" "${KEY_DIR}"
  openssl genpkey -algorithm RSA -pkeyopt "rsa_keygen_bits:${KEY_BITS}" -out "${PRIVATE_KEY_FILE}"
  openssl pkey -in "${PRIVATE_KEY_FILE}" -pubout -out "${PUBLIC_KEY_FILE}"
  chmod "${SECRET_FILE_MODE}" "${PRIVATE_KEY_FILE}"
  chmod "${PUBLIC_FILE_MODE}" "${PUBLIC_KEY_FILE}"
}

key_id() {
  openssl pkey -pubin -in "${PUBLIC_KEY_FILE}" -outform DER |
    openssl dgst -sha256 -hex |
    cut -d' ' -f2 |
    cut -c "1-${KID_LENGTH}"
}

mint_token() {
  local issuer="$1"
  local audience="$2"
  local header payload signing_input signature

  header="$(printf '{"alg":"%s","typ":"%s","kid":"%s"}' "${ALGORITHM}" "${TOKEN_TYPE}" "${KEY_ID}" | base64url)"
  payload="$(printf '{"iss":"%s","aud":"%s","iat":%s,"exp":%s}' "${issuer}" "${audience}" "${ISSUED_AT}" "${EXPIRES_AT}" | base64url)"
  signing_input="${header}.${payload}"
  signature="$(printf '%s' "${signing_input}" | openssl dgst -sha256 -sign "${PRIVATE_KEY_FILE}" | base64url)"
  printf '%s' "${signing_input}.${signature}"
}

expiry_summary() {
  date -u -d "@${EXPIRES_AT}" +%Y-%m-%dT%H:%M:%SZ
}

rotate_tokens() {
  local hop issuer audience token_file

  for hop in "${HOPS[@]}"; do
    issuer="${hop%%:*}"
    audience="${hop##*:}"
    token_file="${KEY_DIR}/${issuer}-to-${audience}.jwt"
    mint_token "${issuer}" "${audience}" > "${token_file}"
    chmod "${SECRET_FILE_MODE}" "${token_file}"
    printf '  %s\n' "${token_file#"${REPO_ROOT}/"}"
  done
}

info() {
  printf 'Development JWT rotation utility.\n'
  printf '\n'
  printf 'Usage:\n'
  printf '  ./rotate-jwt.sh rotate\n'
  printf '\n'
  printf 'This development-only command replaces the current JWT material with:\n'
  printf '  keys/jwt-private.pem  one RSA private key\n'
  printf '  keys/jwt-public.pem   one RSA public key\n'
  printf '  three service JWTs covering web, api, mcp, and tools\n'
  printf '    keys/web-to-api.jwt\n'
  printf '    keys/api-to-mcp.jwt\n'
  printf '    keys/mcp-to-tools.jwt\n'
  printf '\n'
  printf 'No keys or JWTs are generated unless the rotate argument is supplied.\n'
}

print_summary() {
  local hop issuer audience

  printf '\nkeypair\n'
  printf '  keys/jwt-private.pem\n'
  printf '  keys/jwt-public.pem\n'
  printf '\ntokens (kid %s, exp %s)\n' "${KEY_ID}" "$(expiry_summary)"
  for hop in "${HOPS[@]}"; do
    issuer="${hop%%:*}"
    audience="${hop##*:}"
    printf '  keys/%s-to-%s.jwt  iss=%s aud=%s\n' "${issuer}" "${audience}" "${issuer}" "${audience}"
  done

  printf '\nservice env values\n'
  printf '  all   JWT_PUBLIC_KEY_PATH=/app/keys/jwt-public.pem\n'
  printf '  api   JWT_AUDIENCE=api  MCP_JWT_TOKEN_PATH=/app/keys/api-to-mcp.jwt\n'
  printf '  mcp   JWT_AUDIENCE=mcp  TOOLS_JWT_TOKEN_PATH=/app/keys/mcp-to-tools.jwt\n'
  printf '  tools JWT_AUDIENCE=tools\n'
  printf '  web   EXPO_PUBLIC_JWT_TOKEN=%s\n' "$(cat "${KEY_DIR}/web-to-api.jwt")"

  printf '\nnext steps\n'
  printf '  1. cp api/.env.example api/.env    (repeat for mcp/, tools/, web/)\n'
  printf '  2. set APP_MODE=dev for local work, or APP_MODE=prod to enforce verification\n'
  printf '  3. restart the stack: ./scripts/podman-dev.sh up\n'
}

main() {
  if [[ "${1:-}" != "rotate" ]]; then
    info
    return
  fi

  require_openssl
  TTL_SECONDS="${DEFAULT_TTL_SECONDS}"
  ISSUED_AT="$(date +%s)"
  EXPIRES_AT="$((ISSUED_AT + TTL_SECONDS))"

  write_keypair
  KEY_ID="$(key_id)"

  printf 'rotating keys and tokens in %s\n' "${KEY_DIR#"${REPO_ROOT}/"}"
  rotate_tokens
  print_summary
}

main "$@"
