import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

const DEFAULT_PORT = 3000;
const LISTEN_HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  app.enableShutdownHooks();
  await app.listen(port, LISTEN_HOST);

  logger.log(`API listening on ${LISTEN_HOST}:${port}`);
}

void bootstrap();
