# MCP

Lightweight Fastify service that exposes page-2-code tools over MCP Streamable HTTP.

## Responsibilities

- Run as an independent service in the shared Podman pod.
- Expose an HTTP MCP endpoint for the API and future clients.
- Support server-to-client event streaming through Streamable HTTP when required.
- Keep MCP tool definitions separate from the NestJS API.

## Dependencies

`package.json` defines Fastify, the MCP TypeScript server packages, and TypeScript tooling. Install them from the MCP container:

```bash
npm install
```

## Development

The planned server endpoint is port `3002` at `/mcp`.

```bash
npm run dev
```
