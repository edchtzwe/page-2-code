# API

NestJS and TypeScript backend for page-2-code.

## Responsibilities

- Receive screenshot and MP4 uploads.
- Coordinate analysis and staged generation.
- Store workflow data in PostgreSQL through Prisma.
- Use Google AI Studio through `@google/genai`.
- Use OpenRouter through the OpenAI SDK.
- Connect to the dedicated MCP service over HTTP.

## Dependencies

`package.json` defines the initial dependencies. Install them from the API container:

```bash
npm install
```

## Prisma

PostgreSQL is available inside the Podman pod at `localhost:5432`. Configure `DATABASE_URL` before using Prisma.

```bash
export DATABASE_URL='postgresql://page_2_code:page_2_code_dev@localhost:5432/page_2_code?schema=public'
npx prisma init
npx prisma generate
```

## AI credentials

```bash
export GOOGLE_API_KEY='replace-me'
export OPENROUTER_API_KEY='replace-me'
```

## Development

```bash
npm run dev
```

## Black-box API checks

| Method | Path | Expected check |
| :--- | :--- | :--- |
| `GET` | `/health` | `200` and API service identity. |
| `GET` | `/mcp/tools` | `200` and the tool list returned by `mcp/`. |
| `POST` | `/jobs` | `202`, a queued job ID, and a `Location` header pointing to that job. |
| `GET` | `/jobs/{jobId}` | `200` and the matching job ID/status. |

The Bruno collection is in `../bruno/page-2-code`. It checks catalogue discovery and job queue responses; it does not execute tools.

## Configuration

`api/.env` is gitignored, required at startup, and loaded once into the injected API configuration service; `api/.env.example` is the committed contract with empty values.

| Variable | Purpose |
| :--- | :--- |
| `APP_MODE` | `dev` skips JWT verification; anything else is treated as `prod` and enforces it. |
| `JWT_AUDIENCE` | Expected `aud` claim on inbound tokens. |
| `JWT_PUBLIC_KEY_PATH` | RSA public key used to verify inbound tokens. |
| `MCP_JWT_TOKEN_PATH` | Token presented to `mcp/`. |
| `TOOLS_JWT_TOKEN_PATH` | Token presented to `tools/`. |
| `MCP_URL` | Base URL for the MCP service; defaults to `http://mcp:3002` inside the Compose network. |

`JwtAuthMiddleware` is applied to every route from `AppModule.configure`, so it runs before any controller and no entrypoint repeats the `APP_MODE` check. `/health` and CORS preflight requests stay open. `../rotate-jwt.sh` generates the keypair and the tokens.
