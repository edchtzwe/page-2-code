# Tools

Python FastAPI RESTful service that hosts the tool implementations executed by `mcp/`.

`mcp/` owns the MCP Streamable HTTP transport and the published tool schemas. This service owns execution. Every MCP tool call is dispatched here over HTTP, so the transport layer stays thin and the tool surface gets direct access to the system-operations ecosystem.

## Why Python

The tool surface is mostly system operations. Python has mature, maintained bindings for what page-2-code needs:

- Deterministic filesystem primitives map cleanly onto `read_file`, `edit_file`, and `patch_file`.
- OCR through Tesseract, plus the image preprocessing that OCR accuracy depends on.
- Archive, PDF, and media inspection without new runtime dependencies.

## Planned tool surface

| Tool | Method and path | Purpose |
| :--- | :--- | :--- |
| `read_file` | `POST /tools/read-file` | Read a file and return its content and metadata. |
| `edit_file` | `POST /tools/edit-file` | Replace one exact text span in a single file. |
| `patch_file` | `POST /tools/patch-file` | Apply a bounded multi-hunk patch across one or more files. |
| `ocr_image` | `POST /tools/ocr-image` | Extract text from a screenshot through Tesseract. |

Planned additions: layout and typography extraction, colour and spacing sampling, and MP4 frame sampling.

Every tool asserts its required parameters and resolves paths inside a configured workspace root before touching the filesystem. Requests are validated with Pydantic models and no tool accepts an unbounded path.

## Service shape

- `/health` for readiness.
- `/tools/{tool}` for execution.
- `/docs` for the generated OpenAPI interface.

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

Tesseract is a system package and belongs in the image build, not in `requirements.txt`.

## Status

README only. There is no service code yet, and `scripts/podman-dev.sh` does not build or run a `tools/` container yet, so no port is reserved for this service.
