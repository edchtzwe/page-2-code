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
- `web/` — future React Native and NativeWind application.

## Podman development pod

A single Podman pod runs PostgreSQL, the API, MCP server, and web development containers. Every application container mounts the full repository at `/app`.

```bash
./scripts/podman-dev.sh up
```

Enter a service container with Podman:

```bash
podman exec -it page-2-code-api bash
podman exec -it page-2-code-mcp bash
podman exec -it page-2-code-web bash
```

Stop and remove the development pod:

```bash
./scripts/podman-dev.sh down
```

The `:Z` volume suffix is useful on SELinux-enabled hosts. Remove it if it is not required by the host.
