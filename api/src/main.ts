import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { ApiConfigService } from './config/config.service';

const LISTEN_HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const config: ApiConfigService = app.get(ApiConfigService);

  app.enableCors();
  app.enableShutdownHooks();
  await app.listen(config.apiPort, LISTEN_HOST);

  logger.log(`API listening on ${LISTEN_HOST}:${config.apiPort}`);
}

void bootstrap();
