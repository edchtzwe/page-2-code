import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { JobsQueue } from './jobs/jobs.queue';
import { ApiReadinessService } from './readiness.service';

describe('ApiReadinessService', () => {
  it('reports ready when the job queue accepts Redis commands', async () => {
    const jobsQueue = { assertReady: vi.fn().mockResolvedValue(undefined) } as unknown as JobsQueue;
    const service = new ApiReadinessService(jobsQueue);

    await expect(service.assertReady()).resolves.toBeUndefined();
    expect(jobsQueue.assertReady).toHaveBeenCalledTimes(1);
  });

  it('rejects readiness when the job queue is unavailable', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const jobsQueue = { assertReady: vi.fn().mockRejectedValue(new Error('Redis unavailable')) } as unknown as JobsQueue;
    const service = new ApiReadinessService(jobsQueue);

    await expect(service.assertReady()).rejects.toThrow('job queue unavailable');
  });
});
