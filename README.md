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

## Podman development stack

A single development stack runs PostgreSQL, the API, MCP server, and web containers. Every application container mounts the full repository at `/app`, and each one idles in a sleep loop so you can enter it and install dependencies by hand.

### Podman Compose

`compose.yaml` defines the stack.

```bash
podman compose up -d
podman compose up -d api
```

Enter a service container:

```bash
podman exec -it page-2-code-api bash
podman exec -it page-2-code-mcp bash
podman exec -it page-2-code-web bash
```

Stop and remove the stack:

```bash
podman compose down
```

### Podman pod script

`scripts/podman-dev.sh` builds the same three images and runs the same four containers inside a single pod instead of a Compose project.

```bash
./scripts/podman-dev.sh up
./scripts/podman-dev.sh down
```

The `:Z` volume suffix is useful on SELinux-enabled hosts. Remove it if it is not required by the host.
