import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { ApiConfigService } from '../config/config.service';

const MCP_TOOLS_PATH = '/mcp/tools';
const AUTHORIZATION_HEADER = 'authorization';
const CONTENT_TYPE_HEADER = 'content-type';
const BEARER_PREFIX = 'Bearer ';

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolListResponse {
  readonly tools: McpToolDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMcpToolDefinition(value: unknown): value is McpToolDefinition {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    isRecord(value.inputSchema)
  );
}

function parseToolListResponse(value: unknown): ToolListResponse {
  if (!isRecord(value) || !Array.isArray(value.tools) || !value.tools.every(isMcpToolDefinition)) {
    throw new ServiceUnavailableException('MCP service returned an invalid tools list');
  }
  return { tools: value.tools };
}

@Injectable()
export class McpProxyService {
  private readonly logger = new Logger(McpProxyService.name);

  constructor(private readonly config: ApiConfigService) {}

  async getTools(): Promise<ToolListResponse> {
    const headers: Record<string, string> = { [CONTENT_TYPE_HEADER]: 'application/json' };
    const token: string | undefined = this.config.mcpServiceToken;
    if (token !== undefined) {
      headers[AUTHORIZATION_HEADER] = `${BEARER_PREFIX}${token}`;
    }

    try {
      const response: Response = await fetch(`${this.config.mcpBaseUrl}${MCP_TOOLS_PATH}`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        this.logger.warn(`MCP tools request returned ${response.status}`);
        throw new ServiceUnavailableException('MCP tools list is unavailable');
      }
      return parseToolListResponse(await response.json());
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      const message: string = error instanceof Error ? error.message : String(error);
      this.logger.error(`MCP tools request failed: ${message}`);
      throw new ServiceUnavailableException('MCP service is unavailable');
    }
  }
}
