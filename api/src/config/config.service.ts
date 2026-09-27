import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const CONFIG_FILE_NAME = '.env';
const DEFAULT_REDIS_HOST = 'redis';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_API_PORT = 3000;
const DEFAULT_JWT_AUDIENCE = 'api';
const DEFAULT_MCP_BASE_URL = 'http://mcp:3002';
const MIN_PORT = 1;
const MAX_PORT = 65535;
const APP_MODE_ENV = 'APP_MODE';
const JWT_AUDIENCE_ENV = 'JWT_AUDIENCE';
const JWT_PUBLIC_KEY_PATH_ENV = 'JWT_PUBLIC_KEY_PATH';
const MCP_TOKEN_PATH_ENV = 'MCP_JWT_TOKEN_PATH';

export const APP_MODE_DEV = 'dev';
export const APP_MODE_PROD = 'prod';

export type AppMode = typeof APP_MODE_DEV | typeof APP_MODE_PROD;

export interface RedisConnection {
  readonly host: string;
  readonly port: number;
}

export interface JwtVerificationConfig {
  readonly audience: string;
  readonly publicKey: string;
}

@Injectable()
export class ApiConfigService {
  readonly appMode: AppMode;
  readonly apiPort: number;
  readonly databaseUrl: string | undefined;
  readonly redisConnection: RedisConnection;
  readonly jwtVerification: JwtVerificationConfig;
  readonly mcpBaseUrl: string;
  readonly mcpServiceToken: string | undefined;

  constructor() {
    const values: NodeJS.Dict<string> = this.readConfigFile();

    this.appMode = this.readAppMode(values);
    this.apiPort = this.readPort(values, 'PORT', DEFAULT_API_PORT);
    this.databaseUrl = this.readOptional(values, 'DATABASE_URL');
    this.redisConnection = {
      host: this.readOptional(values, 'REDIS_HOST') ?? DEFAULT_REDIS_HOST,
      port: this.readPort(values, 'REDIS_PORT', DEFAULT_REDIS_PORT),
    };
    this.jwtVerification = this.readJwtVerification(values);
    this.mcpBaseUrl = this.readOptional(values, 'MCP_URL') ?? DEFAULT_MCP_BASE_URL;
    this.mcpServiceToken = this.readToken(values, MCP_TOKEN_PATH_ENV);
  }

  get isProductionMode(): boolean {
    return this.appMode === APP_MODE_PROD;
  }

  private readConfigFile(): NodeJS.Dict<string> {
    const configPath: string = resolve(process.cwd(), CONFIG_FILE_NAME);
    if (!existsSync(configPath)) {
      throw new Error(`required configuration file is missing: ${configPath}`);
    }
    return parseEnv(readFileSync(configPath, 'utf8'));
  }

  private readAppMode(values: NodeJS.Dict<string>): AppMode {
    return this.readOptional(values, APP_MODE_ENV) === APP_MODE_DEV ? APP_MODE_DEV : APP_MODE_PROD;
  }

  private readJwtVerification(values: NodeJS.Dict<string>): JwtVerificationConfig {
    const audience: string = this.readOptional(values, JWT_AUDIENCE_ENV) ?? DEFAULT_JWT_AUDIENCE;
    const publicKeyPath: string | undefined = this.readOptional(values, JWT_PUBLIC_KEY_PATH_ENV);

    if (publicKeyPath === undefined) {
      if (this.isProductionMode) {
        throw new Error(`${JWT_PUBLIC_KEY_PATH_ENV} is required when ${APP_MODE_ENV}=${APP_MODE_PROD}`);
      }
      return { audience, publicKey: '' };
    }
    return { audience, publicKey: readFileSync(publicKeyPath, 'utf8') };
  }

  private readToken(values: NodeJS.Dict<string>, name: string): string | undefined {
    const tokenPath: string | undefined = this.readOptional(values, name);
    return tokenPath === undefined ? undefined : readFileSync(tokenPath, 'utf8').trim();
  }

  private readPort(values: NodeJS.Dict<string>, name: string, defaultPort: number): number {
    const rawPort: string | undefined = this.readOptional(values, name);
    if (rawPort === undefined) {
      return defaultPort;
    }

    const parsedPort: number = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(parsedPort) || parsedPort < MIN_PORT || parsedPort > MAX_PORT) {
      throw new Error(`invalid ${name}: ${rawPort}`);
    }
    return parsedPort;
  }

  private readOptional(values: NodeJS.Dict<string>, name: string): string | undefined {
    const value: string | undefined = values[name];
    if (value === undefined) {
      return undefined;
    }
    const trimmed: string = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
}
