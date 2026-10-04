import { Controller, Get } from '@nestjs/common';

import { ApiReadinessService } from './readiness.service';

const API_SERVICE_NAME = 'page-2-code-api';
const SERVICE_STATUS_OK = 'ok';
const SERVICE_VERSION = '0.0.0';

@Controller()
export class HealthController {
  constructor(private readonly readiness: ApiReadinessService) {}

  @Get('health')
  getHealth(): { status: string; service: string; version: string } {
    return {
      status: SERVICE_STATUS_OK,
      service: API_SERVICE_NAME,
      version: SERVICE_VERSION,
    };
  }

  @Get('ready')
  async getReadiness(): Promise<{ status: string; service: string; version: string }> {
    await this.readiness.assertReady();
    return this.getHealth();
  }
}
