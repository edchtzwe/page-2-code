import { Injectable } from '@nestjs/common';

import { ApiConfigService } from '../config/config.service';

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class ServiceTokenService {
  constructor(private readonly config: ApiConfigService) {}

  readMcpAuthorizationHeader(): string | undefined {
    const token: string | undefined = this.config.mcpServiceToken;
    return token === undefined ? undefined : `${BEARER_PREFIX}${token}`;
  }
}
