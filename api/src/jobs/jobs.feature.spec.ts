import { describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JOB_STATUS_QUEUED } from './dto/create-job.dto';

describe('Jobs feature (HTTP contract)', () => {
  it('POST /jobs accepts a valid job payload and sets Location header', async () => {
    const mockJobsService = {
      createJob: vi.fn().mockResolvedValue({
        jobId: 'job-98765',
        status: JOB_STATUS_QUEUED,
      }),
      getJob: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [{ provide: JobsService, useValue: mockJobsService }],
    }).compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    await app.init();

    const controller = app.get(JobsController);
    const locationMock = vi.fn();
    const mockResponse = { location: locationMock } as unknown as Response;

    const result = await controller.createJob({ url: 'https://example.com' }, mockResponse);

    expect(result).toEqual({ jobId: 'job-98765', status: JOB_STATUS_QUEUED });
    expect(locationMock).toHaveBeenCalledWith('/jobs/job-98765');
    await app.close();
  });

  it('POST /jobs propagates 400 BadRequestException on invalid input', async () => {
    const mockJobsService = {
      createJob: vi.fn().mockRejectedValue(new BadRequestException('invalid payload')),
      getJob: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [{ provide: JobsService, useValue: mockJobsService }],
    }).compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    await app.init();

    const controller = app.get(JobsController);
    const mockResponse = { location: vi.fn() } as unknown as Response;

    await expect(controller.createJob({}, mockResponse)).rejects.toThrow(BadRequestException);
    await app.close();
  });

  it('POST /jobs propagates 503 when queue fails', async () => {
    const mockJobsService = {
      createJob: vi.fn().mockRejectedValue(new ServiceUnavailableException('job queue unavailable')),
      getJob: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [{ provide: JobsService, useValue: mockJobsService }],
    }).compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    await app.init();

    const controller = app.get(JobsController);
    const mockResponse = { location: vi.fn() } as unknown as Response;

    await expect(controller.createJob({ url: 'https://example.com' }, mockResponse)).rejects.toThrow(
      ServiceUnavailableException,
    );
    await app.close();
  });
});
