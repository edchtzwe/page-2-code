import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ApiConfigModule } from '../config/config.module';
import { ApiConfigService, RedisConnection } from '../config/config.service';
import { JobsController } from './jobs.controller';
import { JOB_QUEUE_NAME } from './jobs.constants';
import { JobsQueue } from './jobs.queue';
import { JobsService } from './jobs.service';

interface BullConnectionOptions {
  readonly connection: RedisConnection;
}

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ApiConfigModule],
      inject: [ApiConfigService],
      useFactory: (config: ApiConfigService): BullConnectionOptions => ({ connection: config.redisConnection }),
    }),
    BullModule.registerQueue({ name: JOB_QUEUE_NAME }),
  ],
  controllers: [JobsController],
  providers: [JobsService, JobsQueue],
  exports: [JobsQueue],
})
export class JobsModule {}
