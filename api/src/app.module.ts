import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { JwtAuthMiddleware } from './auth/jwt-auth.middleware';
import { ServiceTokenService } from './auth/service-token';
import { ApiConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { JobsModule } from './jobs/jobs.module';
import { McpController } from './mcp/mcp.controller';
import { McpProxyService } from './mcp/mcp-proxy.service';
import { ApiReadinessService } from './readiness.service';

const ALL_ROUTES = '*';

@Module({
  imports: [ApiConfigModule, JobsModule],
  controllers: [HealthController, McpController],
  providers: [McpProxyService, ServiceTokenService, ApiReadinessService],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {}
}
