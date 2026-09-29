import { McpConfig } from '../config/config';

const BEARER_PREFIX = 'Bearer ';
const TOOLS_PATH_PREFIX = '/tools/';
const CONTENT_TYPE_HEADER = 'content-type';

export interface ToolsCallResult {
  readonly status: number;
  readonly body: unknown;
}

export function toolsAuthorizationHeader(config: McpConfig): string | undefined {
  const token: string | undefined = config.toolsServiceToken;
  return token === undefined ? undefined : `${BEARER_PREFIX}${token}`;
}

export async function callTool(config: McpConfig, tool: string, payload: unknown): Promise<ToolsCallResult> {
  const headers: Record<string, string> = { [CONTENT_TYPE_HEADER]: 'application/json' };
  const authorization: string | undefined = toolsAuthorizationHeader(config);
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }

  const response: Response = await fetch(`${config.toolsBaseUrl}${TOOLS_PATH_PREFIX}${tool}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response?.ok) {
    const status: number = response?.status ?? 500;
    throw new Error(`tools call failed: ${tool} responded ${status}`);
  }
  return { status: response.status, body };
}
