# Tools

Python FastAPI RESTful service that hosts the tool implementations executed by `mcp/`.

`mcp/` owns the MCP Streamable HTTP transport and the published tool schemas. This service owns execution. Every MCP tool call is dispatched here over HTTP, so the transport layer stays thin and the tool surface gets direct access to the system-operations ecosystem.

## Why Python

The tool surface is mostly system operations. Python has mature, maintained bindings for what page-2-code needs:

- Deterministic filesystem primitives map cleanly onto `read_file`, `write_file`, `edit_file`, `patch_file`, and `list_dir`.
- OCR through Tesseract, plus the image preprocessing that OCR accuracy depends on.
- Archive, PDF, and media inspection without new runtime dependencies.

## Tool surface

| Tool | Method and path | Purpose |
| :--- | :--- | :--- |
| `read_file` | `POST /tools/read-file` | Read a file and return its content and metadata. |
| `write_file` | `POST /tools/write-file` | Write a file atomically, creating parent directories. |
| `edit_file` | `POST /tools/edit-file` | Replace one exact text span in a single file. |
| `patch_file` | `POST /tools/patch-file` | Apply a bounded multi-hunk patch across one or more files. |
| `list_dir` | `POST /tools/list-dir` | List directory entries with type and size. |
| `ocr_image` | `POST /tools/ocr-image` | Extract text from a screenshot through Tesseract. |

Planned additions: layout and typography extraction, colour and spacing sampling, and MP4 frame sampling.

Every tool asserts its required parameters and resolves paths inside `TOOLS_WORKSPACE_ROOT` (default `/app`) before touching the filesystem. Requests are validated with Pydantic models and no tool accepts an unbounded path.

## Configuration

`tools/.env` is gitignored, required at startup, and loaded once into the tools configuration object; `tools/.env.example` is the committed contract with empty values.

| Variable | Purpose |
| :--- | :--- |
| `APP_MODE` | `dev` skips JWT verification; anything else is treated as `prod` and enforces it. |
| `JWT_AUDIENCE` | Expected `aud` claim on inbound tokens. |
| `JWT_PUBLIC_KEY_PATH` | RSA public key used to verify inbound tokens. |
| `TOOLS_WORKSPACE_ROOT` | Directory the filesystem tools are confined to. |
| `FORTRESS_CDP_URL` | CDP endpoint for crawl and screencast tools. |

`JwtAuthMiddleware` is registered on the app before any route, so every request is verified against the public key and no handler repeats the `APP_MODE` check. `/health` stays open so the container healthcheck keeps working. `../rotate-jwt.sh` generates the keypair and the tokens.

## Development

Run the FastAPI development server from `tools/` with:

```bash
make dev
```

## Service shape

- `/health` for readiness.
- `/tools/{tool}` for execution.
- `/openapi.json` for the generated tool catalogue; call it directly during the Bruno smoke test.
- `/docs` for the interactive OpenAPI interface.
- Port `8000` inside the `page-2-code` Compose network; `mcp/` reaches it at `http://tools:8000`.
- `FORTRESS_CDP_URL` (`http://fortress:9222`) as the CDP endpoint for crawl and screencast tools.

## Dependencies

| Package | Version |
| :--- | :--- |
| Python | 3.14 |
| fastapi | 0.141.1 |
| uvicorn | 0.53.0 |
| pydantic | 2.13.5 |
| python-multipart | 0.0.32 |
| pytesseract | 0.3.13 |
| pillow | 12.3.0 |

`requirements.txt` pins the filesystem subset the service currently needs. Tesseract is a system package and belongs in the image build, not in `requirements.txt`. `ffmpeg` is installed by `tools/Dockerfile` for the screencast frame pipe described in `workflow/phase-1/WORKFLOW_SPEC.md`.

## Status

The filesystem tool group is implemented in `app/`: `read_file`, `write_file`, `edit_file`, `patch_file`, and `list_dir`. Paths reject symlink targets and must resolve inside the workspace root. OCR, layout and typography extraction, colour and spacing sampling, and MP4 frame sampling are not implemented, so Tesseract is not installed in the image yet. `tools/Dockerfile` builds the service and `compose.yaml` runs it as the `tools` service on port `8000`.
