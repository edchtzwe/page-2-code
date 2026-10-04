import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { McpProxyService } from './mcp-proxy.service';
import type { ApiConfigService } from '../config/config.service';

function createMockConfig(overrides: Partial<ApiConfigService> = {}): ApiConfigService {
  return {
    mcpBaseUrl: 'http://mcp:3002',
    mcpServiceToken: undefined,
    ...overrides,
  } as unknown as ApiConfigService;
}

describe('McpProxyService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  it('requests tools without authorization header when mcpServiceToken is undefined (dev mode)', async () => {
    const config = createMockConfig({ mcpServiceToken: undefined });
    const service = new McpProxyService(config);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tools: [
          {
            name: 'scrape_page',
            description: 'Scrapes HTML content',
            inputSchema: { type: 'object' },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await service.getTools();

    expect(mockFetch).toHaveBeenCalledWith('http://mcp:3002/mcp/tools', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
      },
    });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('scrape_page');

    vi.unstubAllGlobals();
  });

  it('attaches Bearer token in authorization header when mcpServiceToken is configured (prod mode)', async () => {
    const config = createMockConfig({ mcpServiceToken: 'jwt-mcp-token-value' });
    const service = new McpProxyService(config);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tools: [],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await service.getTools();

    expect(mockFetch).toHaveBeenCalledWith('http://mcp:3002/mcp/tools', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer jwt-mcp-token-value',
      },
    });

    vi.unstubAllGlobals();
  });

  it('throws ServiceUnavailableException when MCP endpoint returns non-OK status or network fails', async () => {
    const config = createMockConfig();
    const service = new McpProxyService(config);

    const mockFetchFail = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', mockFetchFail);

    await expect(service.getTools()).rejects.toThrow(ServiceUnavailableException);

    vi.unstubAllGlobals();
  });
});
