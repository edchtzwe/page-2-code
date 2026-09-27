import { Controller, Get } from '@nestjs/common';

import { McpProxyService, ToolListResponse } from './mcp-proxy.service';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcpProxy: McpProxyService) {}

  @Get('tools')
  getTools(): Promise<ToolListResponse> {
    return this.mcpProxy.getTools();
  }
}
