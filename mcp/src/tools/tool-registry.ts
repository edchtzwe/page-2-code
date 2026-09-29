import { Redis } from 'ioredis';
import { McpConfig } from '../config/config';
import { toolsAuthorizationHeader } from './tools-client';

const CONTENT_TYPE_HEADER = 'content-type';
const OPENAPI_PATH = '/openapi.json';
const TOOLS_PREFIX = '/tools/';
const SCHEMA_REFERENCE_KEY = '$ref';
const COMPONENT_SCHEMA_REFERENCE_PREFIX = '#/components/schemas/';
const EMPTY_OBJECT_SCHEMA: Record<string, unknown> = { type: 'object', properties: {} };
const TOOLS_CACHE_REDIS_KEY = 'mcp:tools:definitions';

export interface ToolDefinition {
  readonly name: string;
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Recursively resolves and inlines OpenAPI `$ref` references (e.g. `#/components/schemas/Foo`)
 * into a standalone, dereferenced JSON Schema.
 *
 * Input shape:
 * - `value`: Schema fragment, object, array, or primitive.
 *   e.g. `{ "$ref": "#/components/schemas/User", "description": "Custom override" }`
 *   or `{ type: "array", items: { "$ref": "#/components/schemas/Item" } }`
 * - `components`: Map of schemas from `openapi.components.schemas`.
 *   e.g. `{ User: { type: "object", properties: { id: { type: "string" } } } }`
 * - `resolvingComponents`: Set tracking the current resolution chain to detect cycles.
 *
 * Expected outcome:
 * - Dereferenced JSON Schema with all `$ref` links expanded inline and sibling properties merged.
 *   e.g. `{ type: "object", properties: { id: { type: "string" } }, description: "Custom override" }`
 *
 * @throws Error on malformed reference, unknown schema name, or circular dependency.
 */
function resolveSchemaReferences(
  value: unknown,
  components: Record<string, unknown>,
  resolvingComponents: ReadonlySet<string> = new Set<string>(),
): unknown {
  // 1. Traverse array elements recursively
  if (Array.isArray(value)) {
    return value.map((item: unknown) => resolveSchemaReferences(item, components, resolvingComponents));
  }

  // 2. Base case: primitives and non-record values pass through unchanged
  const schema = asRecord(value);
  if (schema === undefined) {
    return value;
  }

  // 3. Handle $ref pointer: '#/components/schemas/<ComponentName>'
  const reference = stringValue(schema[SCHEMA_REFERENCE_KEY]);
  if (reference?.startsWith(COMPONENT_SCHEMA_REFERENCE_PREFIX) === true) {
    const componentName = reference.slice(COMPONENT_SCHEMA_REFERENCE_PREFIX.length);
    if (componentName.length === 0) {
      throw new Error('tools service returned an invalid component schema reference');
    }
    // Guard against circular schema reference loops (e.g. A -> B -> A)
    if (resolvingComponents.has(componentName)) {
      throw new Error(`tools service returned a circular component schema reference: ${componentName}`);
    }

    // Look up component definition in OpenAPI components
    const componentSchema = Object.prototype.hasOwnProperty.call(components, componentName)
      ? asRecord(components[componentName])
      : undefined;
    if (componentSchema === undefined) {
      throw new Error(`tools service returned an unknown component schema: ${componentName}`);
    }

    // Recursively resolve the referenced component with current name added to cycle detector
    const nextResolvingComponents = new Set<string>(resolvingComponents);
    nextResolvingComponents.add(componentName);
    const resolvedComponent = resolveSchemaReferences(componentSchema, components, nextResolvingComponents);
    const resolvedRecord = asRecord(resolvedComponent);
    if (resolvedRecord === undefined) {
      throw new Error(`tools service returned an invalid component schema: ${componentName}`);
    }

    // Merge in sibling properties from the referencing node (e.g. description override)
    const siblingProperties = Object.fromEntries(
      Object.entries(schema)
        .filter(([key]: [string, unknown]) => key !== SCHEMA_REFERENCE_KEY)
        .map(([key, siblingValue]: [string, unknown]) => [
          key,
          resolveSchemaReferences(siblingValue, components, resolvingComponents),
        ]),
    );
    return { ...resolvedRecord, ...siblingProperties };
  }

  // 4. Standard object: recursively resolve all child keys/properties
  return Object.fromEntries(
    Object.entries(schema).map(([key, schemaValue]: [string, unknown]) => [
      key,
      resolveSchemaReferences(schemaValue, components, resolvingComponents),
    ]),
  );
}

function readInputSchema(
  operation: Record<string, unknown>,
  components: Record<string, unknown>,
): Record<string, unknown> {
  const requestBody = asRecord(operation.requestBody);
  const content = asRecord(requestBody?.content);
  const jsonContent = asRecord(content?.['application/json']);
  const schema = asRecord(jsonContent?.schema) ?? EMPTY_OBJECT_SCHEMA;
  return asRecord(resolveSchemaReferences(schema, components)) ?? EMPTY_OBJECT_SCHEMA;
}

function extractToolDefinitions(openapiValue: unknown): ToolDefinition[] {
  const openapi = asRecord(openapiValue);
  const paths = asRecord(openapi?.paths);
  const componentsRoot = asRecord(openapi?.components);
  const components = asRecord(componentsRoot?.schemas) ?? {};
  if (paths === undefined) {
    throw new Error('tools service returned an invalid OpenAPI document');
  }

  const tools: ToolDefinition[] = [];
  for (const [path, methodsValue] of Object.entries(paths)) {
    if (!path.startsWith(TOOLS_PREFIX)) {
      continue;
    }

    const methods = asRecord(methodsValue);
    const operation = asRecord(methods?.post);
    if (operation === undefined) {
      continue;
    }

    const name: string = path.slice(TOOLS_PREFIX.length);
    const summary: string = stringValue(operation.summary) ?? name;
    tools.push({
      name,
      path,
      summary,
      description: stringValue(operation.description) ?? summary,
      inputSchema: readInputSchema(operation, components),
    });
  }

  if (tools.length === 0) {
    throw new Error('tools service returned no tool endpoints');
  }
  return tools;
}

function isToolDefinition(value: unknown): value is ToolDefinition {
  const record = asRecord(value);
  if (record === undefined) {
    return false;
  }
  return (
    typeof record.name === 'string' &&
    typeof record.path === 'string' &&
    typeof record.summary === 'string' &&
    typeof record.description === 'string' &&
    asRecord(record.inputSchema) !== undefined
  );
}

function parseCachedTools(cachedJson: string): ToolDefinition[] | undefined {
  try {
    const parsed: unknown = JSON.parse(cachedJson);
    if (Array.isArray(parsed) && parsed.every(isToolDefinition)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export class ToolRegistry {
  private readonly redis: Redis;

  constructor(private readonly config: McpConfig) {
    this.redis = new Redis({
      host: config.redisConnection.host,
      port: config.redisConnection.port,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async invalidateAndRefresh(): Promise<ToolDefinition[]> {
    const freshTools: ToolDefinition[] = await this.fetchToolsFromUpstream();
    await this.setCachedTools(freshTools);
    return freshTools;
  }

  async getTools(): Promise<ToolDefinition[]> {
    const cached: ToolDefinition[] | undefined = await this.getCachedTools();
    if (cached !== undefined && cached.length > 0) {
      return cached;
    }

    const freshTools: ToolDefinition[] = await this.fetchToolsFromUpstream();
    await this.setCachedTools(freshTools);
    return freshTools;
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private async getCachedTools(): Promise<ToolDefinition[] | undefined> {
    try {
      const cachedValue: string | null = await this.redis.get(TOOLS_CACHE_REDIS_KEY);
      if (cachedValue === null) {
        return undefined;
      }
      return parseCachedTools(cachedValue);
    } catch {
      return undefined;
    }
  }

  private async setCachedTools(tools: ToolDefinition[]): Promise<void> {
    try {
      const serialized: string = JSON.stringify(tools);
      await this.redis.set(
        TOOLS_CACHE_REDIS_KEY,
        serialized,
        'EX',
        this.config.toolsCacheTtlSeconds,
      );
    } catch {
      return;
    }
  }

  private async fetchToolsFromUpstream(): Promise<ToolDefinition[]> {
    const headers: Record<string, string> = { [CONTENT_TYPE_HEADER]: 'application/json' };
    const authorization: string | undefined = toolsAuthorizationHeader(this.config);
    if (authorization !== undefined) {
      headers.authorization = authorization;
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.toolsBaseUrl}${OPENAPI_PATH}`, {
        method: 'GET',
        headers,
      });
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      throw new Error(`tools service request failed: ${message}`);
    }

    if (!response.ok) {
      throw new Error(`tools service returned ${response.status}`);
    }

    let openapi: unknown;
    try {
      openapi = await response.json();
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      throw new Error(`tools service returned invalid JSON: ${message}`);
    }

    return extractToolDefinitions(openapi);
  }
}
