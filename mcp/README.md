# MCP

Fastify service exposing tool discovery over REST and MCP Streamable HTTP. Tool definitions are fetched from the Python service's OpenAPI document; tool execution is intentionally stubbed at the MCP protocol layer for the current Bruno smoke-test phase.

## Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/health` | MCP service health. |
| `GET` | `/mcp/tools` | REST catalogue used by the API proxy and Bruno. Returns `502` if `tools/` cannot provide a valid catalogue. |
| `POST` | `/mcp` | MCP JSON-RPC endpoint; supports `initialize` and `tools/list`. |
| `GET` | `/openapi.json` on `tools/` | Direct tools-service catalogue source. |

Run `npm run dev` from this directory for local development. The server listens on `MCP_HOST`/`MCP_PORT`, defaulting to `0.0.0.0:3002`.

## Configuration

`mcp/.env` is gitignored, required at startup, and loaded once into the MCP configuration object; `mcp/.env.example` is the committed contract with empty values.

| Variable | Purpose |
| :--- | :--- |
| `APP_MODE` | `dev` skips JWT verification; anything else is treated as `prod` and enforces it. |
| `JWT_AUDIENCE` | Expected `aud` claim on inbound tokens. |
| `JWT_PUBLIC_KEY_PATH` | RSA public key used to verify inbound tokens. |
| `TOOLS_BASE_URL` | Tools service base URL; defaults to `http://tools:8000` inside Compose. |
| `TOOLS_JWT_TOKEN_PATH` | Token presented to `tools/`. |

The `onRequest` hook verifies protected requests before route handlers; `/health` stays open. The MCP tool-list route fetches `GET /openapi.json` directly, without a Redis cache dependency. MCP tool calls return an explicit not-enabled result in this phase.
