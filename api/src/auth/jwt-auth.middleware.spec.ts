import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { JwtAuthMiddleware } from './jwt-auth.middleware';
import type { ApiConfigService } from '../config/config.service';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function createMockConfig(overrides: Partial<ApiConfigService> = {}): ApiConfigService {
  return {
    isProductionMode: false,
    jwtVerification: {
      audience: 'api',
      publicKey: publicKey.toString(),
    },
    ...overrides,
  } as unknown as ApiConfigService;
}

function createMockRequest(headers: Record<string, string> = {}, path = '/jobs', method = 'POST'): Request {
  return {
    headers: { ...headers },
    path,
    method,
  } as unknown as Request;
}

function createMockResponse(): {
  response: Response;
  statusMock: ReturnType<typeof vi.fn>;
  jsonMock: ReturnType<typeof vi.fn>;
  setHeaderMock: ReturnType<typeof vi.fn>;
} {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  const setHeaderMock = vi.fn();

  const response = {
    status: statusMock,
    setHeader: setHeaderMock,
  } as unknown as Response;

  return { response, statusMock, jsonMock, setHeaderMock };
}

function mintToken(payload: Record<string, unknown>, privKey = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${body}`), privKey).toString('base64url');
  return `${header}.${body}.${signature}`;
}

describe('JwtAuthMiddleware (Living Auth Specification)', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  describe('Dev Mode (APP_MODE=dev)', () => {
    it('bypasses authentication completely without authorization header', () => {
      const config = createMockConfig({ isProductionMode: false });
      const middleware = new JwtAuthMiddleware(config);
      const req = createMockRequest({}, '/jobs/submit', 'POST');
      const { response, statusMock } = createMockResponse();
      const next = vi.fn();

      middleware.use(req, response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(statusMock).not.toHaveBeenCalled();
    });
  });

  describe('Prod Mode (APP_MODE=prod)', () => {
    it('bypasses authentication for OPTIONS preflight and /health endpoint', () => {
      const config = createMockConfig({ isProductionMode: true });
      const middleware = new JwtAuthMiddleware(config);
      const { response } = createMockResponse();

      const healthNext = vi.fn();
      middleware.use(createMockRequest({}, '/health', 'GET'), response, healthNext);
      expect(healthNext).toHaveBeenCalledTimes(1);

      const optionsNext = vi.fn();
      middleware.use(createMockRequest({}, '/jobs', 'OPTIONS'), response, optionsNext);
      expect(optionsNext).toHaveBeenCalledTimes(1);
    });

    it('rejects with 401 and WWW-Authenticate header when authorization header is missing', () => {
      const config = createMockConfig({ isProductionMode: true });
      const middleware = new JwtAuthMiddleware(config);
      const req = createMockRequest({}, '/jobs', 'POST');
      const { response, statusMock, jsonMock, setHeaderMock } = createMockResponse();
      const next = vi.fn();

      middleware.use(req, response, next);

      expect(next).not.toHaveBeenCalled();
      expect(setHeaderMock).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ statusCode: 401, message: 'unauthorized' });
    });

    it('rejects with 401 when scheme is not Bearer or token is blank', () => {
      const config = createMockConfig({ isProductionMode: true });
      const middleware = new JwtAuthMiddleware(config);
      const { response, statusMock } = createMockResponse();
      const next = vi.fn();

      middleware.use(createMockRequest({ authorization: 'Basic dXNlcjpwYXNz' }), response, next);
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();

      middleware.use(createMockRequest({ authorization: 'Bearer   ' }), response, next);
      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('rejects with 401 when token has invalid signature, wrong audience, or is expired', () => {
      const config = createMockConfig({ isProductionMode: true });
      const middleware = new JwtAuthMiddleware(config);
      const { response, statusMock } = createMockResponse();
      const next = vi.fn();

      // Corrupt token
      middleware.use(createMockRequest({ authorization: 'Bearer invalid.jwt.token' }), response, next);
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();

      // Wrong audience
      const wrongAudToken = mintToken({ aud: 'wrong-service', exp: Math.floor(Date.now() / 1000) + 3600 });
      middleware.use(createMockRequest({ authorization: `Bearer ${wrongAudToken}` }), response, next);
      expect(statusMock).toHaveBeenCalledWith(401);

      // Expired token
      const expiredToken = mintToken({ aud: 'api', exp: Math.floor(Date.now() / 1000) - 100 });
      middleware.use(createMockRequest({ authorization: `Bearer ${expiredToken}` }), response, next);
      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('permits request when a valid RS256 token matching audience and key is provided', () => {
      const config = createMockConfig({ isProductionMode: true });
      const middleware = new JwtAuthMiddleware(config);
      const validToken = mintToken({ aud: 'api', exp: Math.floor(Date.now() / 1000) + 3600 });
      const req = createMockRequest({ authorization: `Bearer ${validToken}` });
      const { response, statusMock } = createMockResponse();
      const next = vi.fn();

      middleware.use(req, response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(statusMock).not.toHaveBeenCalled();
    });
  });
});
