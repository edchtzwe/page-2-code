import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
} from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import Fastify, { FastifyInstance } from 'fastify';

import { createJwtAuthHook } from './auth/jwt-hook';
import { McpConfig } from './config/config';
import { ToolDefinition, ToolRegistry } from './tools/tool-registry';
import { callTool } from './tools/tools-client';

const SERVICE_NAME = 'page-2-code-mcp';
const SERVICE_VERSION = '0.0.0';
const SERVICE_STATUS_OK = 'ok';
const HEALTH_PATH = '/health';
const MCP_PROTOCOL_PATH = '/mcp';
const TOOLS_LIST_PATH = '/mcp/tools';
const TOOLS_CALL_PATH = '/mcp/tools/:name';
const TOOL_EXECUTION_DISABLED = 'Tool execution is not enabled in this phase.';
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
const HTTP_STATUS_BAD_GATEWAY = 502;
const ERROR_TOOLS_UNAVAILABLE = 'tools service unavailable';
const ERROR_INVALID_PARAMS = 'invalid tool parameters';

export function buildServer(config: McpConfig, registry?: ToolRegistry): FastifyInstance {
  const server: FastifyInstance = Fastify({ logger: true });
  const toolRegistry: ToolRegistry = registry ?? new ToolRegistry(config);
  const mcpHttpHandler = createMcpHandler(async () => {
    const tools: ToolDefinition[] = (await toolRegistry.getTools()) ?? [];
    const mcpServer: McpServer = new McpServer({ name: SERVICE_NAME, version: SERVICE_VERSION });

    for (const tool of tools) {
      if (!tool?.name) {
        continue;
      }
      const inputSchema = tool?.inputSchema ? fromJsonSchema(tool.inputSchema as JsonSchemaType) : undefined;
      mcpServer.registerTool(
        tool.name,
        {
          description: tool?.description ?? '',
          inputSchema,
        },
        async () => ({
          content: [{ type: 'text', text: TOOL_EXECUTION_DISABLED }],
          isError: true,
        }),
      );
    }
    return mcpServer;
  }, { legacy: 'stateless', onerror: (error: Error) => server.log.error(error) });
  const handleMcpRequest = toNodeHandler(mcpHttpHandler, {
    onerror: (error: Error) => server.log.error(error),
  });

  server.addHook('onClose', async () => {
    await mcpHttpHandler.close();
    await toolRegistry.close();
  });

  server.addHook('onRequest', createJwtAuthHook(config));

  server.get(HEALTH_PATH, async () => ({
    status: SERVICE_STATUS_OK,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
  }));

  server.get(TOOLS_LIST_PATH, async (request, reply) => {
    try {
      const tools: ToolDefinition[] = (await toolRegistry.getTools()) ?? [];
      return {
        tools: tools
          .filter((tool: ToolDefinition) => Boolean(tool?.name))
          .map((tool: ToolDefinition) => ({
            name: tool?.name ?? '',
            description: tool?.description ?? '',
            inputSchema: tool?.inputSchema ?? {},
          })),
      };
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to load tools from tools service');
      return reply.status(HTTP_STATUS_BAD_GATEWAY).send({ error: ERROR_TOOLS_UNAVAILABLE });
    }
  });

  server.route({
    method: ['DELETE', 'GET', 'POST'],
    url: MCP_PROTOCOL_PATH,
    handler: async (request, reply) => {
      await handleMcpRequest(request.raw, reply.raw, request.body);
      return reply;
    },
  });

  server.post<{ Params: { name: string }; Body: unknown }>(TOOLS_CALL_PATH, async (request, reply) => {
    const name: string | undefined = request?.params?.name;
    if (!name) {
      return reply.status(HTTP_STATUS_BAD_REQUEST).send({ error: ERROR_INVALID_PARAMS });
    }
    try {
      const result = await callTool(config, name, request?.body);
      const status: number = result?.status ?? HTTP_STATUS_INTERNAL_SERVER_ERROR;
      const body: unknown = result?.body ?? null;
      return reply.status(status).send(body);
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      return reply.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: message });
    }
  });

  return server;
}

async function main(): Promise<void> {
  const config: McpConfig = new McpConfig();
  const registry: ToolRegistry = new ToolRegistry(config);
  const server: FastifyInstance = buildServer(config, registry);
  try {
    await registry.invalidateAndRefresh();
  } catch (error: unknown) {
    server.log.warn({ err: error }, 'Failed initial tools refresh on startup; will retry on request');
  }
  await server.listen({ host: config.host, port: config.port });
}

void main();
