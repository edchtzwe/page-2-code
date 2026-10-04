import { describe, expect, it } from 'vitest';
import { ServiceTokenService } from './service-token';
import type { ApiConfigService } from '../config/config.service';

function createMockConfig(mcpServiceToken?: string): ApiConfigService {
  return {
    mcpServiceToken,
  } as unknown as ApiConfigService;
}

describe('ServiceTokenService', () => {
  it('returns undefined if mcpServiceToken is not configured in ApiConfigService', () => {
    const config = createMockConfig(undefined);
    const service = new ServiceTokenService(config);

    expect(service.readMcpAuthorizationHeader()).toBeUndefined();
  });

  it('formats bearer authorization header when mcpServiceToken is present', () => {
    const config = createMockConfig('secret-mcp-token-xyz');
    const service = new ServiceTokenService(config);

    expect(service.readMcpAuthorizationHeader()).toBe('Bearer secret-mcp-token-xyz');
  });
});
