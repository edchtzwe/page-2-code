import { describe, expect, it, vi } from 'vitest';
import { McpController } from './mcp.controller';
import type { McpProxyService, ToolListResponse } from './mcp-proxy.service';

describe('McpController', () => {
  it('delegates getTools to McpProxyService and returns tool definitions', async () => {
    const expectedResponse: ToolListResponse = {
      tools: [
        {
          name: 'render_page',
          description: 'Renders page screenshots',
          inputSchema: { type: 'object' },
        },
      ],
    };

    const mockMcpProxyService = {
      getTools: vi.fn().mockResolvedValue(expectedResponse),
    } as unknown as McpProxyService;

    const controller = new McpController(mockMcpProxyService);
    const result = await controller.getTools();

    expect(mockMcpProxyService.getTools).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expectedResponse);
  });
});
