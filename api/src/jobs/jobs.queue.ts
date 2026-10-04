import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { JOB_QUEUE_NAME } from './jobs.constants';

const JOB_NAME = 'reconstruct';
const JOB_ATTEMPTS = 3;
const JOB_BACKOFF_TYPE = 'exponential';
const JOB_BACKOFF_DELAY_MS = 5_000;
const COMPLETED_JOBS_RETAINED = 200;
const FAILED_JOBS_RETAINED = 500;

export interface ReconstructJobData {
  readonly url: string;
}

export interface BullJobRecord {
  readonly id: string;
  readonly state: string;
  readonly data: ReconstructJobData;
  readonly failedReason?: string;
}

@Injectable()
export class JobsQueue {
  private readonly logger = new Logger(JobsQueue.name);

  constructor(@InjectQueue(JOB_QUEUE_NAME) private readonly queue: Queue<ReconstructJobData>) {}

  async enqueue(url: string): Promise<string> {
    const jobId: string = randomUUID();

    await this.queue.add(
      JOB_NAME,
      { url },
      {
        jobId,
        attempts: JOB_ATTEMPTS,
        backoff: { type: JOB_BACKOFF_TYPE, delay: JOB_BACKOFF_DELAY_MS },
        removeOnComplete: { count: COMPLETED_JOBS_RETAINED },
        removeOnFail: { count: FAILED_JOBS_RETAINED },
      },
    );

    this.logger.log(`enqueued job ${jobId}`);
    return jobId;
  }

  async assertReady(): Promise<void> {
    const client = await this.queue.getBackend().client;
    await client.ping();
  }

  async getJob(jobId: string): Promise<BullJobRecord | undefined> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return undefined;
    }

    const state: string = await job.getState();
    return {
      id: job.id ?? jobId,
      state,
      data: job.data,
      failedReason: job.failedReason,
    };
  }
}
