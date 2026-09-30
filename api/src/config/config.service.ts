import { Injectable } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const CONFIG_FILE_NAME = '.env';
const DEFAULT_REDIS_HOST = 'redis';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_API_PORT = 3000;
const DEFAULT_JWT_AUDIENCE = 'api';
const DEFAULT_MCP_BASE_URL = 'http://mcp:3002';
const DEFAULT_VAULT_SECRET_PATH = 'secret/data/page-2-code/api';
const VAULT_HEADER_TOKEN = 'X-Vault-Token';
const MIN_PORT = 1;
const MAX_PORT = 65535;

const APP_MODE_ENV = 'APP_MODE';
const JWT_AUDIENCE_ENV = 'JWT_AUDIENCE';
const VAULT_ADDR_ENV = 'VAULT_ADDR';
const VAULT_TOKEN_ENV = 'VAULT_TOKEN';
const VAULT_SECRET_PATH_ENV = 'VAULT_SECRET_PATH';

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

interface VaultResponse {
  readonly data?: {
    readonly data?: Record<string, unknown>;
  };
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
    this.mcpBaseUrl = this.readOptional(values, 'MCP_URL') ?? DEFAULT_MCP_BASE_URL;

    if (!this.isProductionMode) {
      const audience: string = this.readOptional(values, JWT_AUDIENCE_ENV) ?? DEFAULT_JWT_AUDIENCE;
      this.jwtVerification = { audience, publicKey: '' };
      this.mcpServiceToken = undefined;
      return;
    }

    const vaultSecrets: Record<string, string> = this.fetchVaultSecrets(values);
    this.jwtVerification = this.resolveJwtVerification(values, vaultSecrets);
    this.mcpServiceToken = this.resolveMcpServiceToken(vaultSecrets);
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

  private resolveMcpServiceToken(vaultSecrets: Record<string, string>): string {
    const token: string | undefined = vaultSecrets['MCP_JWT_TOKEN'];
    if (!token || token.trim() === '') {
      throw new Error('MCP_JWT_TOKEN is missing or empty in Vault secrets. Refusing to start.');
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

  private readOptional(values: NodeJS.Dict<string>, name: string): string | undefined {
    const value: string | undefined = values[name];
    if (value === undefined) {
      return undefined;
    }
    const trimmed: string = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
}
