import { describe, expect, it } from 'vitest';
import { ApiConfigService } from '../config/config.service';
import { McpProxyService } from './mcp-proxy.service';

const TIMEOUT_MS = 2000;

async function isMcpServiceReady(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(`${baseUrl}/ready`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

describe('API to MCP cross-service integration', () => {
  it('fetches tool list from MCP when service is ready, or skips gracefully', async () => {
    let config: ApiConfigService;
    try {
      config = new ApiConfigService();
    } catch {
      return;
    }

    const ready = await isMcpServiceReady(config.mcpBaseUrl);
    if (!ready) {
      console.warn(`[SKIP] MCP service at ${config.mcpBaseUrl} is not ready. Skipping cross-service integration test.`);
      return;
    }

    const proxy = new McpProxyService(config);
    const result = await proxy.getTools();

    expect(Array.isArray(result.tools)).toBe(true);
  });
});
