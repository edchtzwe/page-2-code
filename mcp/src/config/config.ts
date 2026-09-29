import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const CONFIG_FILE_NAME = '.env';
const DEFAULT_MCP_HOST = '0.0.0.0';
const DEFAULT_MCP_PORT = 3002;
const DEFAULT_REDIS_HOST = 'redis';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_TOOLS_BASE_URL = 'http://tools:8000';
const DEFAULT_TOOLS_CACHE_TTL_SECONDS = 2592000;
const DEFAULT_JWT_AUDIENCE = 'mcp';
const MIN_PORT = 1;
const MAX_PORT = 65535;
const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 2592000;
const APP_MODE_ENV = 'APP_MODE';
const JWT_AUDIENCE_ENV = 'JWT_AUDIENCE';
const JWT_PUBLIC_KEY_PATH_ENV = 'JWT_PUBLIC_KEY_PATH';
const TOOLS_TOKEN_PATH_ENV = 'TOOLS_JWT_TOKEN_PATH';
const TOOLS_CACHE_TTL_ENV = 'TOOLS_CACHE_TTL_SECONDS';
const REDIS_HOST_ENV = 'REDIS_HOST';
const REDIS_PORT_ENV = 'REDIS_PORT';

export const APP_MODE_DEV = 'dev';
export const APP_MODE_PROD = 'prod';

export type AppMode = typeof APP_MODE_DEV | typeof APP_MODE_PROD;

export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
}

export interface JwtVerificationConfig {
  readonly audience: string;
  readonly publicKey: string;
}

export class McpConfig {
  readonly appMode: AppMode;
  readonly host: string;
  readonly port: number;
  readonly redisConnection: RedisConnectionConfig;
  readonly toolsBaseUrl: string;
  readonly toolsCacheTtlSeconds: number;
  readonly toolsServiceToken: string | undefined;
  readonly jwtVerification: JwtVerificationConfig;

  constructor() {
    const values: NodeJS.Dict<string> = this.readConfigFile();

    this.appMode = this.readAppMode(values);
    this.host = this.readOptional(values, 'MCP_HOST') ?? DEFAULT_MCP_HOST;
    this.port = this.readPort(values, 'MCP_PORT', DEFAULT_MCP_PORT);
    this.redisConnection = {
      host: this.readOptional(values, REDIS_HOST_ENV) ?? DEFAULT_REDIS_HOST,
      port: this.readPort(values, REDIS_PORT_ENV, DEFAULT_REDIS_PORT),
    };
    this.toolsBaseUrl = this.readOptional(values, 'TOOLS_BASE_URL') ?? DEFAULT_TOOLS_BASE_URL;
    this.toolsCacheTtlSeconds = this.readTtlSeconds(
      values,
      TOOLS_CACHE_TTL_ENV,
      DEFAULT_TOOLS_CACHE_TTL_SECONDS,
    );
    this.toolsServiceToken = this.readToken(values, TOOLS_TOKEN_PATH_ENV);
    this.jwtVerification = this.readJwtVerification(values);
  }

  get isProductionMode(): boolean {
    return this.appMode === APP_MODE_PROD;
  }

  private readConfigFile(): NodeJS.Dict<string> {
    const configPath: string = resolve(process.cwd(), CONFIG_FILE_NAME);
    if (!existsSync(configPath)) {
      throw new Error(`required configuration file is missing: ${configPath}`);
    }
    try {
      return parseEnv(readFileSync(configPath, 'utf8'));
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to parse configuration file ${configPath}: ${message}`);
    }
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
    try {
      return { audience, publicKey: readFileSync(publicKeyPath, 'utf8') };
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to read JWT public key file ${publicKeyPath}: ${message}`);
    }
  }

  private readToken(values: NodeJS.Dict<string>, name: string): string | undefined {
    const tokenPath: string | undefined = this.readOptional(values, name);
    if (tokenPath === undefined) {
      return undefined;
    }
    try {
      return readFileSync(tokenPath, 'utf8').trim();
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to read token file ${tokenPath}: ${message}`);
    }
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

  private readTtlSeconds(
    values: NodeJS.Dict<string>,
    name: string,
    defaultTtl: number,
  ): number {
    const rawTtl: string | undefined = this.readOptional(values, name);
    if (rawTtl === undefined) {
      return defaultTtl;
    }

    const parsedTtl: number = Number.parseInt(rawTtl, 10);
    if (
      !Number.isInteger(parsedTtl) ||
      parsedTtl < MIN_TTL_SECONDS ||
      parsedTtl > MAX_TTL_SECONDS
    ) {
      throw new Error(`invalid ${name}: ${rawTtl}`);
    }
    return parsedTtl;
  }

  private readOptional(values: NodeJS.Dict<string>, name: string): string | undefined {
    if (!values || !Object.prototype.hasOwnProperty.call(values, name)) {
      return undefined;
    }
    const value: string | undefined = values[name];
    if (value === undefined) {
      return undefined;
    }
    const trimmed: string = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
}
