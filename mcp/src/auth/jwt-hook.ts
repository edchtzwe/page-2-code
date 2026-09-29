import type { FastifyReply, FastifyRequest } from 'fastify';
import { verify } from 'jsonwebtoken';
import type { Algorithm } from 'jsonwebtoken';

import { McpConfig } from '../config/config';

const AUTHORIZATION_HEADER = 'authorization';
const BEARER_PREFIX = 'Bearer ';
const BEARER_PREFIX_OFFSET = BEARER_PREFIX.length;
const OPTIONS_METHOD = 'OPTIONS';
const HEALTH_PATH = '/health';
const QUERY_SEPARATOR = '?';
const UNAUTHORIZED_STATUS = 401;
const UNAUTHORIZED_BODY = { detail: 'unauthorized' };
const JWT_ALGORITHMS: Algorithm[] = ['RS256'];
const WWW_AUTHENTICATE_HEADER = 'WWW-Authenticate';
const WWW_AUTHENTICATE_VALUE = 'Bearer';

function requestPath(request: FastifyRequest): string {
  const url: string = request?.url ?? '';
  const [path] = url.split(QUERY_SEPARATOR);
  return path ?? '';
}

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const headerValue: string | undefined = Array.isArray(header) ? header[0] : header;
  if (headerValue === undefined || !headerValue.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  const token: string = headerValue.slice(BEARER_PREFIX_OFFSET).trim();
  return token === '' ? undefined : token;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reject(request: FastifyRequest, reply: FastifyReply, reason: string): void {
  request?.log?.warn(`rejected request: ${reason}`);
  void reply
    ?.code(UNAUTHORIZED_STATUS)
    ?.header(WWW_AUTHENTICATE_HEADER, WWW_AUTHENTICATE_VALUE)
    ?.send(UNAUTHORIZED_BODY);
}

export function createJwtAuthHook(
  config: McpConfig,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function jwtAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!config?.isProductionMode) {
      return;
    }

    if (request?.method === OPTIONS_METHOD || requestPath(request) === HEALTH_PATH) {
      return;
    }

    const authHeader = request?.headers?.[AUTHORIZATION_HEADER];
    const token: string | undefined = extractBearerToken(authHeader);
    if (token === undefined) {
      reject(request, reply, 'missing bearer token');
      return;
    }

    try {
      verify(token, config.jwtVerification.publicKey, {
        algorithms: JWT_ALGORITHMS,
        audience: config.jwtVerification.audience,
      });
    } catch (error: unknown) {
      reject(request, reply, describeError(error));
    }
  };
}
