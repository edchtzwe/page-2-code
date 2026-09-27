import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { UrlSafetyResult, resolveTargetHost, validateTargetUrl } from '../common/url-safety';
import {
  CreateJobRequest,
  CreateJobResponse,
  GetJobResponse,
  JOB_STATUS_ACTIVE,
  JOB_STATUS_COMPLETED,
  JOB_STATUS_FAILED,
  JOB_STATUS_QUEUED,
  JOB_STATUS_UNKNOWN,
  JobStatus,
  isCreateJobRequest,
} from './dto/create-job.dto';
import { BullJobRecord as QueueJobRecord, JobsQueue } from './jobs.queue';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapBullStateToJobStatus(state: string): JobStatus {
  switch (state) {
    case 'waiting':
    case 'delayed':
    case 'prioritized':
      return JOB_STATUS_QUEUED;
    case 'active':
      return JOB_STATUS_ACTIVE;
    case 'completed':
      return JOB_STATUS_COMPLETED;
    case 'failed':
      return JOB_STATUS_FAILED;
    default:
      return JOB_STATUS_UNKNOWN;
  }
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly queue: JobsQueue) {}

  async createJob(body: unknown): Promise<CreateJobResponse> {
    if (!isCreateJobRequest(body)) {
      throw new BadRequestException('body must contain exactly one string property: url');
    }

    const request: CreateJobRequest = body;
    const safety: UrlSafetyResult = validateTargetUrl(request.url);
    if (!safety.safe) {
      this.logger.warn(`rejected url: ${safety.reason}`);
      throw new BadRequestException(`unsafe url: ${safety.reason}`);
    }

    const resolution: UrlSafetyResult = await resolveTargetHost(safety.url);
    if (!resolution.safe) {
      this.logger.warn(`rejected url: ${resolution.reason}`);
      throw new BadRequestException(`unsafe url: ${resolution.reason}`);
    }

    try {
      const jobId: string = await this.queue.enqueue(resolution.url);
      return {
        jobId,
        status: JOB_STATUS_QUEUED,
      };
    } catch (error: unknown) {
      this.logger.error(`enqueue failed for ${resolution.url}: ${describeError(error)}`);
      throw new ServiceUnavailableException('job queue unavailable');
    }
  }

  async getJob(jobId: string): Promise<GetJobResponse> {
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      throw new BadRequestException('invalid job id');
    }

    try {
      const record: QueueJobRecord | undefined = await this.queue.getJob(jobId);
      if (record === undefined) {
        throw new NotFoundException(`job ${jobId} not found`);
      }

      const status: JobStatus = mapBullStateToJobStatus(record.state);
      return {
        jobId: record.id,
        status,
        url: record.data.url,
        failedReason: record.failedReason,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`failed to retrieve job ${jobId}: ${describeError(error)}`);
      throw new ServiceUnavailableException('job queue unavailable');
    }
  }
}
