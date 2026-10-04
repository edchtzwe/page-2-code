import { describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ApiReadinessService } from './readiness.service';

describe('Health feature (HTTP contract)', () => {
  it('GET /health returns 200 with service metadata unconditionally', async () => {
    const mockReadiness = { assertReady: vi.fn() };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: ApiReadinessService, useValue: mockReadiness }],
    }).compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    await app.init();

    const controller = app.get(HealthController);
    const result = controller.getHealth();

    expect(result).toEqual({
      status: 'ok',
      service: 'page-2-code-api',
      version: '0.0.0',
    });
    expect(mockReadiness.assertReady).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /ready returns 200 when required queue dependency is ready', async () => {
    const mockReadiness = { assertReady: vi.fn().mockResolvedValue(undefined) };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: ApiReadinessService, useValue: mockReadiness }],
    }).compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    await app.init();

    const controller = app.get(HealthController);
    const result = await controller.getReadiness();

    expect(result).toEqual({
      status: 'ok',
      service: 'page-2-code-api',
      version: '0.0.0',
    });
    expect(mockReadiness.assertReady).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('GET /ready throws 503 when queue dependency is not ready', async () => {
    const mockReadiness = {
      assertReady: vi.fn().mockRejectedValue(new ServiceUnavailableException('job queue unavailable')),
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: ApiReadinessService, useValue: mockReadiness }],
    }).compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    await app.init();

    const controller = app.get(HealthController);
    await expect(controller.getReadiness()).rejects.toThrow(ServiceUnavailableException);
    await app.close();
  });
});
