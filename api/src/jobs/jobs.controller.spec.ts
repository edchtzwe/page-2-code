import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { JobsController } from './jobs.controller';
import type { JobsService } from './jobs.service';
import { JOB_STATUS_QUEUED } from './dto/create-job.dto';

describe('JobsController', () => {
  it('creates job, sets Location header, and returns 202 Accepted payload', async () => {
    const mockJobsService = {
      createJob: vi.fn().mockResolvedValue({
        jobId: 'job-12345',
        status: JOB_STATUS_QUEUED,
      }),
      getJob: vi.fn(),
    } as unknown as JobsService;

    const locationMock = vi.fn();
    const mockResponse = {
      location: locationMock,
    } as unknown as Response;

    const controller = new JobsController(mockJobsService);
    const body = { url: 'https://example.com' };
    const result = await controller.createJob(body, mockResponse);

    expect(mockJobsService.createJob).toHaveBeenCalledWith(body);
    expect(locationMock).toHaveBeenCalledWith('/jobs/job-12345');
    expect(result).toEqual({
      jobId: 'job-12345',
      status: JOB_STATUS_QUEUED,
    });
  });

  it('retrieves job status by id', async () => {
    const mockJobsService = {
      createJob: vi.fn(),
      getJob: vi.fn().mockResolvedValue({
        jobId: 'job-12345',
        status: 'completed',
        url: 'https://example.com',
      }),
    } as unknown as JobsService;

    const controller = new JobsController(mockJobsService);
    const result = await controller.getJob('job-12345');

    expect(mockJobsService.getJob).toHaveBeenCalledWith('job-12345');
    expect(result).toEqual({
      jobId: 'job-12345',
      status: 'completed',
      url: 'https://example.com',
    });
  });
});
