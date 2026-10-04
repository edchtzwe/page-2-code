import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { JobsQueue } from './jobs/jobs.queue';

@Injectable()
export class ApiReadinessService {
  private readonly logger = new Logger(ApiReadinessService.name);

  constructor(private readonly jobsQueue: JobsQueue) {}

  async assertReady(): Promise<void> {
    try {
      await this.jobsQueue.assertReady();
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      this.logger.error(`job queue readiness check failed: ${message}`);
      throw new ServiceUnavailableException('job queue unavailable');
    }
  }
}
