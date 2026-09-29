# page-2-code

AI-powered website reconstruction from screenshots and website videos.

## Current scope

Backend-first development using NestJS and TypeScript (NodeTS). API requests will be tested with Bruno.

The system will accept website screenshots and MP4 recordings, derive visual styling and structure, then return results in stages:

1. Analyze the supplied image or video.
2. Extract layout, typography, colors, spacing, responsive behavior, and other visual rules.
3. Produce a single HTML preview with representative elements.
4. Let the user accept or reject the preview.
5. Generate a structured React codebase using the selected styling approach, such as Tailwind CSS or plain CSS.

This README is intentionally rolling and will be expanded as the product evolves.

## Repository layout

- `api/` — NestJS backend.
- `mcp/` — Fastify-based MCP HTTP server.
- `tools/` — Python FastAPI service hosting the tool implementations dispatched by `mcp/`.
- `web/` — future React Native and NativeWind application.
- `agent/` — planned Python Google ADK worker. It will consume queued reconstruction jobs, reason over the collected visual evidence, and call the MCP tool surface. This directory is not implemented yet.

## Planned ADK agent architecture

Google ADK is intended to be the agent-runtime layer, not the replacement for this repository's MCP or tools services. The planned `agent/` service will be a Python worker that runs Google ADK and consumes BullMQ reconstruction jobs. It belongs beside `api/`, `mcp/`, and `tools/`; it must not be embedded in the Nest API, the MCP transport, or the tool-execution service.

The separation of responsibility is deliberate:

| Component | Responsibility | Must not own |
| :--- | :--- | :--- |
| `web/` | Collect input, display queued/running/completed state, and present the generated preview. | Agent prompting, tool credentials, or direct filesystem access. |
| `api/` | Authenticate callers, validate job requests, create stable job identifiers, enqueue work, expose job status, enforce public API limits, and obtain user approval before code-generation phases. | Model/tool loops or direct browser/filesystem execution. |
| Redis and BullMQ | Deliver jobs to a worker, retry infrastructure failures, and retain enough job state for status lookup. | Product authorization, prompt state, or visual-quality decisions. |
| `agent/` (planned) | Run the ADK session, select the next MCP tool call, create and refine the HTML reconstruction, retain per-run evidence, and return a bounded result. | HTTP-facing product APIs or tool implementation details. |
| `mcp/` | Publish and authenticate the MCP tool contract. It is the transport and schema boundary between an agent client and `tools/`. | Agent policy, prompt orchestration, or privileged raw filesystem access. |
| `tools/` | Execute constrained operations: filesystem changes, browser/CDP capture, frame extraction, visual inspection, and later render/compare operations. | LLM calls, unbounded workflow decisions, or public job management. |

### Target service flow

```text
web
  │ POST /jobs
  ▼
api ── validates request, creates job id, enqueues BullMQ job ──► Redis
                                                              │
                                                              ▼
                                                     agent/ ADK worker
                                                              │
                                      MCP Streamable HTTP + agent-to-mcp JWT
                                                              ▼
                                                            mcp/
                                                              │
                                      authenticated tool call + mcp-to-tools JWT
                                                              ▼
                                                           tools/
                                      │                 │                 │
                                      ▼                 ▼                 ▼
                              job workspace        Fortress CDP     analysis/render tools
                                      │
                                      └── index.html, assets, evidence, result manifest
```

The stable execution path is therefore `web → api → Redis/BullMQ → agent → mcp → tools`. The API owns the customer-facing lifecycle; ADK owns a single job's internal reasoning loop; MCP and tools remain independently testable and reusable by another agent implementation.

### Why ADK is a worker instead of an API dependency

The API must remain deterministic: accept a request, validate it, enqueue it, and report its status. An ADK run is inherently long-lived and variable-duration because it may inspect several inputs, call multiple tools, and perform bounded repair passes. Running that loop inside an API request handler would complicate timeouts, retries, cancellation, observability, and user-facing status.

The worker model also makes failures legible:

- API or validation failure: reject before enqueueing.
- Queue delivery failure: BullMQ retry policy handles it.
- Tool/infrastructure failure: the ADK worker records the failing tool call and either retries within a fixed budget or returns `failed`.
- Visual-quality failure: the worker returns `needs_review` or `best_effort`; it does not loop indefinitely.
- Worker crash: BullMQ redelivers according to the job retry policy without the browser client holding an open request.

### Reconstruction-job contract

The API should enqueue a fully specified reconstruction request rather than a vague instruction. The eventual DTO and BullMQ payload should include at least:

| Field | Purpose |
| :--- | :--- |
| `jobId` | Stable identifier generated by the API and used for logs, workspace paths, and status lookup. |
| `input` | URL, uploaded screenshots, MP4 recording, or the approved combination of those sources. |
| `targetViewport` | Exact viewport dimensions and device scale to reproduce. |
| `outputWorkspace` | Per-job directory, proposed as `/app/jobs/<jobId>/`, never the repository root. |
| `maxIterations` | Strict cap on repair passes; the initial target is three. |
| `timeBudgetSeconds` | Wall-clock ceiling for the ADK run. |
| `requiredArtifacts` | At minimum `index.html`; optionally assets, a design spec, render screenshots, and a result manifest. |
| `qualityGate` | Deterministic structural checks plus the permitted visual-comparison threshold. |
| `sourcePolicy` | Which URLs, hosts, asset types, and external-network actions are allowed for the job. |

The API must validate and normalize this payload before it reaches Redis. The ADK prompt must treat it as the hard boundary for tool use, output location, time, and iteration count.

### ADK's bounded reconstruction loop

ADK should orchestrate the reasoning inside a single job, but the loop must be explicit and finite. The initial implementation should use one reconstruction agent rather than a multi-agent swarm.

```text
1. Load job contract and create an ADK session scoped to jobId.
2. Gather evidence from the approved screenshots, MP4, URL capture, and extracted assets.
3. Produce a structured design specification: layout, typography, colours, spacing,
   breakpoints, motion observations, and asset map.
4. Write a first self-contained index.html and the approved local assets.
5. Render index.html at targetViewport and capture comparison evidence.
6. Compare the render with the reference evidence.
7. If the quality gate fails and iterationCount < maxIterations, patch only the required files.
8. Re-render and repeat from step 6.
9. Verify required artifacts and write a result manifest.
10. Complete the BullMQ job with completed, needs_review, failed, or best_effort status.
```

The loop ends when the quality gate passes, the iteration cap is reached, the time budget expires, or a non-retryable policy/tool failure occurs. “Keep trying until it looks right” is not an acceptable production contract.

### Tool boundary and expected tool evolution

The current filesystem group in `tools/` remains valuable even when ADK supplies convenience file tools. This repository needs workspace-root confinement, atomic writes, exact edits, bounded patches, JWT-authenticated service calls, and an auditable schema. ADK should consume this controlled capability surface through MCP rather than receive broad host filesystem access.

The planned agent needs the following MCP-visible capability groups. Items marked planned must be implemented in `tools/` and published through a real MCP `tools/list`/`tools/call` transport before the agent can rely on them.

| Capability | Status | Purpose |
| :--- | :--- | :--- |
| `read_file`, `write_file`, `edit_file`, `patch_file`, `list_dir` | Implemented in `tools/` | Confined job-workspace operations. |
| MCP discovery and invocation | In progress in `mcp/` | Give ADK a standards-based remote tool interface. |
| Screencast/frame capture | Planned | Produce reproducible URL/video visual evidence through Fortress CDP. |
| Style/layout/typography extraction | Planned | Turn visual evidence into structured reconstruction constraints. |
| Local HTML render and screenshot | Planned | Generate a candidate render at the required viewport. |
| Visual delta comparison | Planned | Score the candidate against approved reference evidence. |
| Artifact/result-manifest inspection | Planned | Confirm index.html, assets, evidence, and final result metadata exist. |

Do not give the agent a generic shell tool in the first production slice. New capabilities must be narrow, parameter-validated, workspace-confined, and exposed as explicit MCP tools.

### First vertical slice

The first ADK implementation must prove the wiring before adding visual-refinement intelligence:

```text
POST /jobs
  → queued BullMQ reconstruction job
  → agent worker consumes it
  → ADK calls the existing MCP filesystem tools
  → agent writes /app/jobs/<jobId>/output/index.html
  → agent returns a result manifest
  → API status endpoint reports the completed artifact path
```

The first slice may create a deliberately simple `index.html`. Its success criterion is reliable end-to-end job execution, authenticated MCP tool use, correct per-job output isolation, and observable job status—not visual fidelity. Browser capture, design-spec generation, render comparison, and iterative patching are the next slices.

### Implementation order and handoff checklist

1. Finish `mcp/` first: implement actual MCP SDK transport, `initialize`, `tools/list`, and `tools/call`; preserve the authenticated tool-service boundary and make tool schemas available from the OpenAPI catalogue.
2. Define the queued reconstruction-job DTO in `api/`, including output workspace, budgets, source policy, and status/result fields. Add a cancellation model before starting long-lived workers.
3. Scaffold `agent/` as a Python service with a pinned Google ADK dependency, its own `.env.example`, Dockerfile, README, structured logging, and a BullMQ-compatible worker adapter.
4. Add a distinct `agent-to-mcp` service token and JWT audience. Do not reuse the API's MCP token for the worker. Extend `rotate-jwt.sh`, Compose configuration, and the documented hop table when this is implemented.
5. Connect the ADK reconstruction agent to `mcp/` over authenticated Streamable HTTP. Its only write capability must target the job workspace.
6. Implement the first vertical slice and make the agent return an explicit result manifest. Persist tool-call and iteration evidence with the job.
7. Add capture, render, compare, and patch tools one capability group at a time. Keep hard limits in the API job contract and enforce them in the worker.
8. Only after a reliable `index.html` reconstruction and human acceptance should a separate code-generation phase create a React/NativeWind project. That is a new job phase, not an implicit side effect of reconstruction.

### Deliberate non-goals for the first ADK slice

- No direct access from ADK to the host filesystem, Docker socket, or arbitrary shell.
- No replacement of `mcp/` or `tools/` with ADK convenience tools.
- No multi-agent delegation until a single-agent execution trace demonstrates a real bottleneck.
- No unbounded self-correction loop, background work without a job record, or output written into the source repository.
- No automatic React conversion before a user accepts the generated HTML preview.

## Podman development stack

`compose.yaml` is the local development orchestration file for the whole stack. Each subsystem builds from its own `Dockerfile`, joins the shared `page-2-code` network, and is addressed by the others through its service name. PostgreSQL, Redis, and the CDP browser run from their standard upstream images.

| Service | Image or build context | Host port | Purpose |
| :--- | :--- | :--- | :--- |
| `postgres` | `postgres:18.6-bookworm` | `5432` | Workflow storage for the API. |
| `redis` | `redis:8.8.3-alpine` | `6379` | BullMQ job queue for the API. |
| `fortress` | `tilion/fortress:latest` | `9224` → `9222` | Patched-Chrome CDP browser for crawl and screencast capture. |
| `tools` | `./tools` | `8000` | Python FastAPI tool service. |
| `api` | `./api` | `3000` | NestJS orchestrator. |
| `mcp` | `./mcp` | `3002` | Fastify MCP server. |
| `web` | `./web` | `8081` | React Native client. |

The API, MCP, tools, and web containers mount the full repository at `/app` and idle in a sleep loop. PostgreSQL, Redis, and Fortress run normally. Enter an application container to install dependencies if needed and start its development server manually.

### Bring the stack up

Every service reads its own gitignored `.env`. The local dev files should use `APP_MODE=dev`; on a fresh checkout, copy the matching examples and set the service URLs and paths before starting the stack. The current local setup is already populated.

```bash
./scripts/podman-dev.sh up
./scripts/podman-dev.sh ps
```

`scripts/podman-dev.sh` is a shorthand wrapper over the same file:

```bash
./scripts/podman-dev.sh up
./scripts/podman-dev.sh ps
./scripts/podman-dev.sh logs
./scripts/podman-dev.sh down
```

### Work inside a container

Open the API container, then run these commands inside its shell:

```bash
podman compose exec api bash
```

```bash
cd /app/api
npm install
npm run dev
```

In another terminal, open MCP and run its commands inside that shell:

```bash
podman compose exec mcp bash
```

```bash
cd /app/mcp
npm install
npm run dev
```

For the FastAPI tools service, open its shell and run the recipe inside it:

```bash
podman compose exec tools bash
```

```bash
cd /app/tools
make dev
```

The web container is available as a shell with `podman compose exec web bash`; frontend implementation is deferred.

### Service-to-service addresses

Inside the network, services address each other by service name and container port:

| From | To | Address |
| :--- | :--- | :--- |
| `api` | `postgres` | `postgres:5432` |
| `api` | `redis` | `redis:6379` |
| `api` | `mcp` | `http://mcp:3002/mcp/tools` |
| `api`, `mcp` | `tools` | `http://tools:8000` |
| `tools` | `fortress` | `http://fortress:9222` or `172.23.0.99:9222` |

The `page-2-code` network is declared with the `172.23.0.0/16` subnet and `fortress` takes the fixed address `172.23.0.99`. Static container addresses need netavark on a rootful Podman; on a rootless host, drop the `ipv4_address` entry and use `http://fortress:9222`.

The `:Z` volume suffix is useful on SELinux-enabled hosts. Remove it if it is not required by the host.

## Configuration

Compose attaches each service's own `.env` through `env_file`. `.env` files are gitignored; `.env.example` files are committed with empty values and are the contract for what each service reads. An empty value is treated as unset, so the service default applies.

| Variable | Used by | Purpose |
| :--- | :--- | :--- |
| `APP_MODE` | every service | `dev` skips JWT verification. Any other value, including an empty or misspelled one, is treated as `prod` and enforces verification. |
| `JWT_AUDIENCE` | every service | Expected `aud` claim on inbound tokens. |
| `JWT_PUBLIC_KEY_PATH` | every service | RSA public key used to verify inbound tokens. |
| `MCP_JWT_TOKEN_PATH` | `api` | Token `api/` presents to `mcp/`. |
| `TOOLS_JWT_TOKEN_PATH` | `mcp` | Token `mcp/` presents to `tools/`. |
| `EXPO_PUBLIC_JWT_TOKEN` | `web` | Token the client presents to `api/`. |

## JWT bootstrap

`rotate-jwt.sh` is the local bootstrap for the unified token format. One run rotates everything:

- a single RSA keypair at `keys/jwt-private.pem` and `keys/jwt-public.pem`;
- one token per service hop, named for the hop: `keys/web-to-api.jwt`, `keys/api-to-mcp.jwt`, `keys/mcp-to-tools.jwt`.

```bash
./rotate-jwt.sh
```

Every token carries `iss` for the caller, `aud` for the receiver, `iat`, and an `exp` of 15 days by default. `JWT_TTL_SECONDS` overrides the lifetime. `keys/` is gitignored and must never be committed.

`web/` holds `web-to-api.jwt` and sends it as `Authorization: Bearer`; `api/` verifies it against the public key and passes `api-to-mcp.jwt` on to `mcp/`, which passes `mcp-to-tools.jwt` on to `tools/`. Restart the services after a rotation so the public key is re-read.

The API is deliberately not configured with a tools token or direct tools URL. Developers may still call the locally exposed `tools/` service directly when they deliberately obtain a valid JWT with `aud=tools`; this does not alter the production API path through `mcp/`.

The tokens exist so the verification path can be exercised end to end. Key custody, issuance, and rotation in production belong to the deploying infrastructure, which has to replace this bootstrap before it publishes anything.
