import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

import { JobsQueue } from './jobs.queue';
import type { ReconstructJobData } from './jobs.queue';

describe('JobsQueue readiness', () => {
  it('pings Redis through the queue backend', async () => {
    const ping = vi.fn().mockResolvedValue('PONG');
    const queue = {
      getBackend: vi.fn().mockReturnValue({ client: Promise.resolve({ ping }) }),
    } as unknown as Queue<ReconstructJobData>;
    const jobsQueue = new JobsQueue(queue);

    await jobsQueue.assertReady();

    expect(queue.getBackend).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
  });
});
