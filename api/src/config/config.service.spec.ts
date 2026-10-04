import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { APP_MODE_DEV, APP_MODE_PROD, ApiConfigService } from './config.service';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const CONFIG_FILE_NAME = '.env';
const ENV_EXAMPLE_PATH = resolve(process.cwd(), '.env.example');
const DEFAULT_API_PORT = 3000;
const DEFAULT_REDIS_HOST = 'redis';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_JWT_AUDIENCE = 'api';
const DEFAULT_MCP_BASE_URL = 'http://mcp:3002';
const DEFAULT_SECRET_PATH = 'secret/data/page-2-code/api';
const VAULT_URL_PATH_FRAGMENT = '/v1/secret/data/page-2-code/api';
const VAULT_HEADER_NAME = 'X-Vault-Token';
const VAULT_TOKEN_VALUE = 'dev-root-token';
const VAULT_ADDR_VALUE = 'http://vault:8200';
const VAULT_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nunit-test-public-key\n-----END PUBLIC KEY-----';
const VAULT_SERVICE_TOKEN = 'unit-test-mcp-token';
const INVALID_PORT_VALUE = '99999';
const UNKNOWN_MODE_VALUE = 'production';
const VAULT_ENV_KEYS: string[] = ['VAULT_ADDR', 'VAULT_TOKEN', 'VAULT_SECRET_PATH'];

const DEV_ENV: Record<string, string> = {
  APP_MODE: APP_MODE_DEV,
  JWT_AUDIENCE: DEFAULT_JWT_AUDIENCE,
  PORT: '',
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/page_2_code?schema=public',
  REDIS_HOST: '',
  REDIS_PORT: '',
  MCP_URL: '',
  VAULT_ADDR: '',
  VAULT_TOKEN: '',
  VAULT_SECRET_PATH: '',
};

const PROD_ENV: Record<string, string> = {
  ...DEV_ENV,
  APP_MODE: APP_MODE_PROD,
  VAULT_ADDR: VAULT_ADDR_VALUE,
  VAULT_TOKEN: VAULT_TOKEN_VALUE,
  VAULT_SECRET_PATH: DEFAULT_SECRET_PATH,
};

const PROD_ENV_WITHOUT_VAULT: Record<string, string> = {
  ...PROD_ENV,
  VAULT_ADDR: '',
  VAULT_TOKEN: '',
};

const VAULT_ENVELOPE: string = JSON.stringify({
  data: { data: { JWT_PUBLIC_KEY: VAULT_PUBLIC_KEY, MCP_JWT_TOKEN: VAULT_SERVICE_TOKEN } },
});

const execFileSyncMock = vi.mocked(execFileSync);

let originalCwd: string;
let tempDir: string;

function renderEnv(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]: [string, string]) => `${name}=${value}`)
    .join('\n')
    .concat('\n');
}

function loadConfig(values: Record<string, string>): ApiConfigService {
  writeFileSync(join(tempDir, CONFIG_FILE_NAME), renderEnv(values), 'utf8');
  process.chdir(tempDir);
  return new ApiConfigService();
}

function interceptedArguments(): string[] {
  return execFileSyncMock.mock.calls[0][1] as unknown as string[];
}

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(join(tmpdir(), 'api-config-spec-'));
  for (const key of VAULT_ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('ApiConfigService .env.example contract', () => {
  it('dev template keys match the committed example', () => {
    const exampleKeys: string[] = Object.keys(parseEnv(readFileSync(ENV_EXAMPLE_PATH, 'utf8'))).sort();
    expect(Object.keys(DEV_ENV).sort()).toEqual(exampleKeys);
  });

  it('prod template keys match the committed example', () => {
    const exampleKeys: string[] = Object.keys(parseEnv(readFileSync(ENV_EXAMPLE_PATH, 'utf8'))).sort();
    expect(Object.keys(PROD_ENV).sort()).toEqual(exampleKeys);
  });
});

describe('ApiConfigService dev mode', () => {
  it('skips Vault entirely and applies defaults', () => {
    const config: ApiConfigService = loadConfig(DEV_ENV);

    expect(config.isProductionMode).toBe(false);
    expect(config.jwtVerification).toEqual({ audience: DEFAULT_JWT_AUDIENCE, publicKey: '' });
    expect(config.mcpServiceToken).toBeUndefined();
    expect(config.apiPort).toBe(DEFAULT_API_PORT);
    expect(config.redisConnection).toEqual({ host: DEFAULT_REDIS_HOST, port: DEFAULT_REDIS_PORT });
    expect(config.mcpBaseUrl).toBe(DEFAULT_MCP_BASE_URL);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...DEV_ENV, PORT: INVALID_PORT_VALUE })).toThrow(/invalid PORT/);
  });
});

describe('ApiConfigService prod mode', () => {
  it('treats an unrecognised mode as prod', () => {
    execFileSyncMock.mockReturnValue(VAULT_ENVELOPE);

    expect(loadConfig({ ...PROD_ENV, APP_MODE: UNKNOWN_MODE_VALUE }).isProductionMode).toBe(true);
  });

  it('resolves the public key and service token from the Vault envelope', () => {
    execFileSyncMock.mockReturnValue(VAULT_ENVELOPE);

    const config: ApiConfigService = loadConfig(PROD_ENV);

    expect(config.isProductionMode).toBe(true);
    expect(config.jwtVerification.publicKey).toBe(VAULT_PUBLIC_KEY);
    expect(config.mcpServiceToken).toBe(VAULT_SERVICE_TOKEN);
  });

  it('requests the configured secret path with the Vault token header', () => {
    execFileSyncMock.mockReturnValue(VAULT_ENVELOPE);

    loadConfig(PROD_ENV);

    const args: string[] = interceptedArguments();
    expect(args[3]).toContain(VAULT_URL_PATH_FRAGMENT);
    expect(args[4]).toBe(VAULT_HEADER_NAME);
    expect(args[5]).toBe(VAULT_TOKEN_VALUE);
  });

  it('refuses to start when Vault connection settings are absent', () => {
    expect(() => loadConfig(PROD_ENV_WITHOUT_VAULT)).toThrow(/Vault configuration missing/);
  });

  it('refuses to start when the Vault envelope has no data payload', () => {
    execFileSyncMock.mockReturnValue(JSON.stringify({}));

    expect(() => loadConfig(PROD_ENV)).toThrow(/missing data\.data payload/);
  });

  it('refuses to start when the public key is absent from the envelope', () => {
    execFileSyncMock.mockReturnValue(JSON.stringify({ data: { data: { MCP_JWT_TOKEN: VAULT_SERVICE_TOKEN } } }));

    expect(() => loadConfig(PROD_ENV)).toThrow(/JWT_PUBLIC_KEY is missing/);
  });

  it('refuses to start when the service token is absent from the envelope', () => {
    execFileSyncMock.mockReturnValue(JSON.stringify({ data: { data: { JWT_PUBLIC_KEY: VAULT_PUBLIC_KEY } } }));

    expect(() => loadConfig(PROD_ENV)).toThrow(/MCP_JWT_TOKEN is missing/);
  });
});
