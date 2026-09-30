import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const DEFAULT_VAULT_SECRET_PATH = 'secret/data/page-2-code/mcp';
const VAULT_HEADER_TOKEN = 'X-Vault-Token';
const MIN_PORT = 1;
const MAX_PORT = 65535;
const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 2592000;

const APP_MODE_ENV = 'APP_MODE';
const JWT_AUDIENCE_ENV = 'JWT_AUDIENCE';
const TOOLS_CACHE_TTL_ENV = 'TOOLS_CACHE_TTL_SECONDS';
const REDIS_HOST_ENV = 'REDIS_HOST';
const REDIS_PORT_ENV = 'REDIS_PORT';
const VAULT_ADDR_ENV = 'VAULT_ADDR';
const VAULT_TOKEN_ENV = 'VAULT_TOKEN';
const VAULT_SECRET_PATH_ENV = 'VAULT_SECRET_PATH';

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

interface VaultResponse {
  readonly data?: {
    readonly data?: Record<string, unknown>;
  };
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

    if (!this.isProductionMode) {
      const audience: string = this.readOptional(values, JWT_AUDIENCE_ENV) ?? DEFAULT_JWT_AUDIENCE;
      this.jwtVerification = { audience, publicKey: '' };
      this.toolsServiceToken = undefined;
      return;
    }

    const vaultSecrets: Record<string, string> = this.fetchVaultSecrets(values);
    this.toolsServiceToken = this.resolveToolsServiceToken(vaultSecrets);
    this.jwtVerification = this.resolveJwtVerification(values, vaultSecrets);
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
    const mode = this.readOptional(values, APP_MODE_ENV);
    return mode === APP_MODE_DEV ? APP_MODE_DEV : APP_MODE_PROD;
  }

  private fetchVaultSecrets(values: NodeJS.Dict<string>): Record<string, string> {
    const vaultAddr: string | undefined = this.readOptional(values, VAULT_ADDR_ENV) ?? process.env[VAULT_ADDR_ENV];
    const vaultToken: string | undefined = this.readOptional(values, VAULT_TOKEN_ENV) ?? process.env[VAULT_TOKEN_ENV];
    const secretPath: string =
      this.readOptional(values, VAULT_SECRET_PATH_ENV) ??
      process.env[VAULT_SECRET_PATH_ENV] ??
      DEFAULT_VAULT_SECRET_PATH;

    if (!vaultAddr || !vaultToken) {
      throw new Error(
        `Vault configuration missing: ${VAULT_ADDR_ENV} and ${VAULT_TOKEN_ENV} are required in ${APP_MODE_PROD} mode. Refusing to start.`,
      );
    }

    const url = `${vaultAddr.replace(/\/+$/, '')}/v1/${secretPath.replace(/^\/+/, '')}`;
    let stdout: string;

    try {
      const script = `
        const res = await fetch(process.argv[1], {
          headers: { [process.argv[2]]: process.argv[3] }
        });
        const text = await res.text();
        if (!res.ok) {
          process.stderr.write(JSON.stringify({ status: res.status, text }));
          process.exit(1);
        }
        process.stdout.write(text);
      `;
      stdout = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', script, url, VAULT_HEADER_TOKEN, vaultToken],
        { encoding: 'utf8' },
      );
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch secrets from Vault at ${url}: ${message}. Refusing to start.`);
    }

    let parsed: VaultResponse;
    try {
      parsed = JSON.parse(stdout) as VaultResponse;
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse Vault response JSON from ${url}: ${message}. Refusing to start.`);
    }

    const rawData = parsed?.data?.data;
    if (!rawData || typeof rawData !== 'object') {
      throw new Error(`Vault response at ${url} is missing data.data payload. Refusing to start.`);
    }

    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawData)) {
      if (v !== null && v !== undefined) {
        result[k] = String(v);
      }
    }
    return result;
  }

  private resolveJwtVerification(
    values: NodeJS.Dict<string>,
    vaultSecrets: Record<string, string>,
  ): JwtVerificationConfig {
    const audience: string = this.readOptional(values, JWT_AUDIENCE_ENV) ?? DEFAULT_JWT_AUDIENCE;
    const publicKey: string | undefined = vaultSecrets['JWT_PUBLIC_KEY'];

    if (!publicKey || publicKey.trim() === '') {
      throw new Error(
        'JWT_PUBLIC_KEY is missing or empty in Vault secrets. Refusing to start.',
      );
    }

    return { audience, publicKey: publicKey.trim() };
  }

  private resolveToolsServiceToken(vaultSecrets: Record<string, string>): string {
    const token: string | undefined = vaultSecrets['TOOLS_JWT_TOKEN'];
    if (!token || token.trim() === '') {
      throw new Error('TOOLS_JWT_TOKEN is missing or empty in Vault secrets. Refusing to start.');
    }
    return token.trim();
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
