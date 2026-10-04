import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';
import type { ApiReadinessService } from './readiness.service';

describe('HealthController', () => {
  it('returns service health status, name, and version without checking dependencies', () => {
    const readiness = { assertReady: vi.fn() } as unknown as ApiReadinessService;
    const controller = new HealthController(readiness);
    const result = controller.getHealth();

    expect(result).toEqual({
      status: 'ok',
      service: 'page-2-code-api',
      version: '0.0.0',
    });
    expect(readiness.assertReady).not.toHaveBeenCalled();
  });

  it('reports ready after required dependencies are ready', async () => {
    const readiness = { assertReady: vi.fn().mockResolvedValue(undefined) } as unknown as ApiReadinessService;
    const controller = new HealthController(readiness);

    await expect(controller.getReadiness()).resolves.toEqual({
      status: 'ok',
      service: 'page-2-code-api',
      version: '0.0.0',
    });
    expect(readiness.assertReady).toHaveBeenCalledTimes(1);
  });
});
