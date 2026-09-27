import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { verify } from 'jsonwebtoken';
import type { Algorithm } from 'jsonwebtoken';

import { ApiConfigService } from '../config/config.service';

const AUTHORIZATION_HEADER = 'authorization';
const BEARER_PREFIX = 'Bearer ';
const BEARER_PREFIX_OFFSET = BEARER_PREFIX.length;
const OPTIONS_METHOD = 'OPTIONS';
const HEALTH_PATH = '/health';
const WWW_AUTHENTICATE_HEADER = 'WWW-Authenticate';
const WWW_AUTHENTICATE_VALUE = 'Bearer';
const UNAUTHORIZED_STATUS = 401;
const UNAUTHORIZED_BODY = { statusCode: UNAUTHORIZED_STATUS, message: 'unauthorized' };
const JWT_ALGORITHMS: Algorithm[] = ['RS256'];

@Injectable()
export class JwtAuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(JwtAuthMiddleware.name);

  constructor(private readonly config: ApiConfigService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (!this.config.isProductionMode) {
      next();
      return;
    }

    if (request.method === OPTIONS_METHOD || request.path === HEALTH_PATH) {
      next();
      return;
    }

    const token: string | undefined = extractBearerToken(request.headers[AUTHORIZATION_HEADER]);
    if (token === undefined) {
      this.reject(response, 'missing bearer token');
      return;
    }

    try {
      verify(token, this.config.jwtVerification.publicKey, {
        algorithms: JWT_ALGORITHMS,
        audience: this.config.jwtVerification.audience,
      });
      next();
    } catch (error: unknown) {
      this.reject(response, describeError(error));
    }
  }

  private reject(response: Response, reason: string): void {
    this.logger.warn(`rejected request: ${reason}`);
    response.setHeader(WWW_AUTHENTICATE_HEADER, WWW_AUTHENTICATE_VALUE);
    response.status(UNAUTHORIZED_STATUS).json(UNAUTHORIZED_BODY);
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  const token: string = header.slice(BEARER_PREFIX_OFFSET).trim();
  return token === '' ? undefined : token;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
