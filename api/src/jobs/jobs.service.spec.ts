import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as urlSafetyModule from '../common/url-safety';
import { JobsService } from './jobs.service';
import type { JobsQueue } from './jobs.queue';
import {
  JOB_STATUS_ACTIVE,
  JOB_STATUS_COMPLETED,
  JOB_STATUS_FAILED,
  JOB_STATUS_QUEUED,
  JOB_STATUS_UNKNOWN,
} from './dto/create-job.dto';

describe('JobsService (Living Jobs Orchestration Specification)', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  describe('createJob', () => {
    it('throws BadRequestException if body is not an object with single url string property', async () => {
      const mockQueue = { enqueue: vi.fn(), getJob: vi.fn() } as unknown as JobsQueue;
      const service = new JobsService(mockQueue);

      await expect(service.createJob(null)).rejects.toThrow(BadRequestException);
      await expect(service.createJob({})).rejects.toThrow(BadRequestException);
      await expect(service.createJob({ url: 123 })).rejects.toThrow(BadRequestException);
      await expect(service.createJob({ url: 'https://example.com', extra: 'bad' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if url violates SSRF checks', async () => {
      const mockQueue = { enqueue: vi.fn(), getJob: vi.fn() } as unknown as JobsQueue;
      const service = new JobsService(mockQueue);

      await expect(service.createJob({ url: 'http://localhost:3000' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createJob({ url: 'file:///etc/passwd' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('enqueues job and returns queued status on valid url', async () => {
      vi.spyOn(urlSafetyModule, 'resolveTargetHost').mockResolvedValueOnce({
        safe: true,
        url: 'https://example.com/',
      });

      const mockQueue = {
        enqueue: vi.fn().mockResolvedValue('job-abc-123'),
        getJob: vi.fn(),
      } as unknown as JobsQueue;
      const service = new JobsService(mockQueue);

      const result = await service.createJob({ url: 'https://example.com' });

      expect(mockQueue.enqueue).toHaveBeenCalledWith('https://example.com/');
      expect(result).toEqual({
        jobId: 'job-abc-123',
        status: JOB_STATUS_QUEUED,
      });
    });

    it('throws ServiceUnavailableException when queue throws', async () => {
      vi.spyOn(urlSafetyModule, 'resolveTargetHost').mockResolvedValueOnce({
        safe: true,
        url: 'https://example.com/',
      });
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      const mockQueue = {
        enqueue: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
        getJob: vi.fn(),
      } as unknown as JobsQueue;
      const service = new JobsService(mockQueue);

      await expect(service.createJob({ url: 'https://example.com' })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('getJob', () => {
    it('throws BadRequestException on blank or invalid jobId', async () => {
      const mockQueue = { enqueue: vi.fn(), getJob: vi.fn() } as unknown as JobsQueue;
      const service = new JobsService(mockQueue);

      await expect(service.getJob('')).rejects.toThrow(BadRequestException);
      await expect(service.getJob('   ')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when job is not found in queue', async () => {
      const mockQueue = {
        enqueue: vi.fn(),
        getJob: vi.fn().mockResolvedValue(undefined),
      } as unknown as JobsQueue;
      const service = new JobsService(mockQueue);

      await expect(service.getJob('job-missing')).rejects.toThrow(NotFoundException);
    });

    it('maps BullMQ states to canonical JobStatus enum', async () => {
      const mockQueue = {
        enqueue: vi.fn(),
        getJob: vi.fn(),
      } as unknown as JobsQueue;
      const service = new JobsService(mockQueue);

      // waiting -> queued
      vi.mocked(mockQueue.getJob).mockResolvedValueOnce({
        id: 'job-1',
        state: 'waiting',
        data: { url: 'https://example.com' },
      });
      expect(await service.getJob('job-1')).toEqual({
        jobId: 'job-1',
        status: JOB_STATUS_QUEUED,
        url: 'https://example.com',
        failedReason: undefined,
      });

      // active -> active
      vi.mocked(mockQueue.getJob).mockResolvedValueOnce({
        id: 'job-2',
        state: 'active',
        data: { url: 'https://example.com' },
      });
      expect(await service.getJob('job-2')).toEqual({
        jobId: 'job-2',
        status: JOB_STATUS_ACTIVE,
        url: 'https://example.com',
        failedReason: undefined,
      });

      // completed -> completed
      vi.mocked(mockQueue.getJob).mockResolvedValueOnce({
        id: 'job-3',
        state: 'completed',
        data: { url: 'https://example.com' },
      });
      expect(await service.getJob('job-3')).toEqual({
        jobId: 'job-3',
        status: JOB_STATUS_COMPLETED,
        url: 'https://example.com',
        failedReason: undefined,
      });

      // failed -> failed with failedReason
      vi.mocked(mockQueue.getJob).mockResolvedValueOnce({
        id: 'job-4',
        state: 'failed',
        data: { url: 'https://example.com' },
        failedReason: 'Page failed to render',
      });
      expect(await service.getJob('job-4')).toEqual({
        jobId: 'job-4',
        status: JOB_STATUS_FAILED,
        url: 'https://example.com',
        failedReason: 'Page failed to render',
      });

      // other -> unknown
      vi.mocked(mockQueue.getJob).mockResolvedValueOnce({
        id: 'job-5',
        state: 'paused',
        data: { url: 'https://example.com' },
      });
      expect(await service.getJob('job-5')).toEqual({
        jobId: 'job-5',
        status: JOB_STATUS_UNKNOWN,
        url: 'https://example.com',
        failedReason: undefined,
      });
    });
  });
});
