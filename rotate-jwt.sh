#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ALGORITHM="RS256"
readonly TOKEN_TYPE="JWT"
readonly KEY_BITS=4096
readonly DEFAULT_TTL_SECONDS=1296000
readonly KID_LENGTH=16
readonly HOPS=("web:api" "api:mcp" "mcp:tools")

readonly VAULT_ADDR="${VAULT_ADDR:-http://127.0.0.1:8200}"
readonly VAULT_TOKEN="${VAULT_TOKEN:-dev-root-token}"
readonly VAULT_HEADER_TOKEN="X-Vault-Token"

TTL_SECONDS=""
KEY_ID=""
ISSUED_AT=""
EXPIRES_AT=""

base64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

require_dependencies() {
  if ! command -v openssl >/dev/null 2>&1; then
    printf 'openssl is required to rotate keys and tokens.\n' >&2
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    printf 'curl is required to communicate with Vault.\n' >&2
    exit 1
  fi
}

key_id() {
  local public_key="$1"
  printf '%s' "${public_key}" |
    openssl pkey -pubin -outform DER |
    openssl dgst -sha256 -hex |
    cut -d' ' -f2 |
    cut -c "1-${KID_LENGTH}"
}

mint_token() {
  local issuer="$1"
  local audience="$2"
  local private_key_file="$3"
  local header payload signing_input signature

  header="$(printf '{"alg":"%s","typ":"%s","kid":"%s"}' "${ALGORITHM}" "${TOKEN_TYPE}" "${KEY_ID}" | base64url)"
  payload="$(printf '{"iss":"%s","aud":"%s","iat":%s,"exp":%s}' "${issuer}" "${audience}" "${ISSUED_AT}" "${EXPIRES_AT}" | base64url)"
  signing_input="${header}.${payload}"
  signature="$(printf '%s' "${signing_input}" | openssl dgst -sha256 -sign "${private_key_file}" | base64url)"
  printf '%s' "${signing_input}.${signature}"
}

expiry_summary() {
  date -u -d "@${EXPIRES_AT}" +%Y-%m-%dT%H:%M:%SZ
}

vault_put() {
  local path="$1"
  local payload="$2"
  local url="${VAULT_ADDR%/}/v1/${path#/}"

  local http_code
  http_code="$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "${VAULT_HEADER_TOKEN}: ${VAULT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${url}")"

  if [[ "${http_code}" != "200" && "${http_code}" != "204" ]]; then
    printf 'failed to write to vault path %s (HTTP %s)\n' "${path}" "${http_code}" >&2
    exit 1
  fi
}

escape_json() {
  python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))'
}

info() {
  printf 'Development JWT rotation utility for Vault.\n'
  printf '\n'
  printf 'Usage:\n'
  printf '  ./rotate-jwt.sh rotate\n'
  printf '\n'
  printf 'This development command generates RSA keypair and tokens in memory/temp and stores them in Vault KV:\n'
  printf '  secret/data/page-2-code/jwt   (private_key, public_key, kid)\n'
  printf '  secret/data/page-2-code/api   (JWT_PUBLIC_KEY, MCP_JWT_TOKEN)\n'
  printf '  secret/data/page-2-code/mcp   (JWT_PUBLIC_KEY, TOOLS_JWT_TOKEN)\n'
  printf '  secret/data/page-2-code/tools (JWT_PUBLIC_KEY)\n'
  printf '\n'
  printf 'No keys or JWTs are generated or written unless the rotate argument is supplied.\n'
}

main() {
  if [[ "${1:-}" != "rotate" ]]; then
    info
    return
  fi

  require_dependencies

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT

  local private_key_file="${tmp_dir}/jwt-private.pem"
  local public_key_file="${tmp_dir}/jwt-public.pem"

  openssl genpkey -algorithm RSA -pkeyopt "rsa_keygen_bits:${KEY_BITS}" -out "${private_key_file}" 2>/dev/null
  openssl pkey -in "${private_key_file}" -pubout -out "${public_key_file}" 2>/dev/null

  local private_key
  local public_key
  private_key="$(cat "${private_key_file}")"
  public_key="$(cat "${public_key_file}")"

  TTL_SECONDS="${DEFAULT_TTL_SECONDS}"
  ISSUED_AT="$(date +%s)"
  EXPIRES_AT="$((ISSUED_AT + TTL_SECONDS))"
  KEY_ID="$(key_id "${public_key}")"

  local web_to_api_token
  local api_to_mcp_token
  local mcp_to_tools_token

  web_to_api_token="$(mint_token "web" "api" "${private_key_file}")"
  api_to_mcp_token="$(mint_token "api" "mcp" "${private_key_file}")"
  mcp_to_tools_token="$(mint_token "mcp" "tools" "${private_key_file}")"

  printf 'writing keys and tokens to Vault at %s...\n' "${VAULT_ADDR}"

  # 1. Store Master JWT material
  local jwt_payload
  jwt_payload="$(python3 -c '
import json, sys
data = {
    "data": {
        "private_key": sys.argv[1],
        "public_key": sys.argv[2],
        "kid": sys.argv[3],
        "web_to_api_jwt": sys.argv[4],
        "api_to_mcp_jwt": sys.argv[5],
        "mcp_to_tools_jwt": sys.argv[6]
    }
}
print(json.dumps(data))
' "${private_key}" "${public_key}" "${KEY_ID}" "${web_to_api_token}" "${api_to_mcp_token}" "${mcp_to_tools_token}")"

  vault_put "secret/data/page-2-code/jwt" "${jwt_payload}"

  # 2. Store API secrets (Public key + outbound MCP token)
  local api_payload
  api_payload="$(python3 -c '
import json, sys
data = {
    "data": {
        "JWT_PUBLIC_KEY": sys.argv[1],
        "MCP_JWT_TOKEN": sys.argv[2]
    }
}
print(json.dumps(data))
' "${public_key}" "${api_to_mcp_token}")"

  vault_put "secret/data/page-2-code/api" "${api_payload}"

  # 3. Store MCP secrets (Public key + outbound Tools token)
  local mcp_payload
  mcp_payload="$(python3 -c '
import json, sys
data = {
    "data": {
        "JWT_PUBLIC_KEY": sys.argv[1],
        "TOOLS_JWT_TOKEN": sys.argv[2]
    }
}
print(json.dumps(data))
' "${public_key}" "${mcp_to_tools_token}")"

  vault_put "secret/data/page-2-code/mcp" "${mcp_payload}"

  # 4. Store Tools secrets (Public key)
  local tools_payload
  tools_payload="$(python3 -c '
import json, sys
data = {
    "data": {
        "JWT_PUBLIC_KEY": sys.argv[1]
    }
}
print(json.dumps(data))
' "${public_key}")"

  vault_put "secret/data/page-2-code/tools" "${tools_payload}"

  printf 'successfully rotated JWT material in Vault (kid %s, exp %s)\n' "${KEY_ID}" "$(expiry_summary)"
  printf '  secret/data/page-2-code/jwt   (master keypair & all tokens)\n'
  printf '  secret/data/page-2-code/api   (JWT_PUBLIC_KEY, MCP_JWT_TOKEN)\n'
  printf '  secret/data/page-2-code/mcp   (JWT_PUBLIC_KEY, TOOLS_JWT_TOKEN)\n'
  printf '  secret/data/page-2-code/tools (JWT_PUBLIC_KEY)\n'
}

main "$@"
