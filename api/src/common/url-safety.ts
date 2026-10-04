import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];
const BLOCKED_HOSTNAMES: readonly string[] = ['localhost'];
const BLOCKED_HOST_SUFFIXES: readonly string[] = ['.localhost', '.local', '.internal', '.home.arpa'];
const ALLOWED_IP_RANGES: readonly string[] = ['unicast'];
const NUMERIC_HOST_PATTERN = /^\d+$/;
const HEX_HOST_PATTERN = /^0x[0-9a-f]+$/i;
const OPENING_BRACKET = '[';
const CLOSING_BRACKET = ']';

export interface SafeTargetUrl {
  readonly safe: true;
  readonly url: string;
}

export interface UnsafeTargetUrl {
  readonly safe: false;
  readonly reason: string;
}

export type UrlSafetyResult = SafeTargetUrl | UnsafeTargetUrl;

function parseCandidate(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== 'string') {
    return null;
  }

  const trimmed: string = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string): string {
  const lowered: string = hostname.toLowerCase();
  if (lowered.startsWith(OPENING_BRACKET) && lowered.endsWith(CLOSING_BRACKET)) {
    return lowered.slice(1, -1);
  }
  return lowered;
}

function isBlockedAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    return true;
  }

  const parsedAddress: ReturnType<typeof ipaddr.process> = ipaddr.process(address);
  return !ALLOWED_IP_RANGES.includes(parsedAddress.range());
}

function inspectHostname(hostname: string): string | null {
  if (hostname === '') {
    return 'hostname is required';
  }
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return `blocked hostname: ${hostname}`;
  }

  const blockedSuffix: string | undefined = BLOCKED_HOST_SUFFIXES.find((suffix: string) => hostname.endsWith(suffix));
  if (blockedSuffix !== undefined) {
    return `blocked hostname suffix: ${blockedSuffix}`;
  }
  if (NUMERIC_HOST_PATTERN.test(hostname) || HEX_HOST_PATTERN.test(hostname)) {
    return `numeric hostname is not allowed: ${hostname}`;
  }

  if (ipaddr.isValid(hostname)) {
    return `direct IP hostnames are not allowed: ${hostname}`;
  }
  return null;
}

export function validateTargetUrl(rawUrl: unknown): UrlSafetyResult {
  const parsed: URL | null = parseCandidate(rawUrl);
  if (parsed === null) {
    return { safe: false, reason: 'url must be a syntactically valid URL' };
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { safe: false, reason: `unsupported protocol: ${parsed.protocol}` };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { safe: false, reason: 'credentials in url are not allowed' };
  }

  const hostnameReason: string | null = inspectHostname(normalizeHostname(parsed.hostname));
  if (hostnameReason !== null) {
    return { safe: false, reason: hostnameReason };
  }
  return { safe: true, url: parsed.toString() };
}

function isBlockedResolvedAddress(address: string): boolean {
  return isBlockedAddress(address);
}

export async function resolveTargetHost(rawUrl: string): Promise<UrlSafetyResult> {
  const parsed: URL | null = parseCandidate(rawUrl);
  if (parsed === null) {
    return { safe: false, reason: 'url must be a syntactically valid URL' };
  }

  const hostname: string = normalizeHostname(parsed.hostname);
  if (ipaddr.isValid(hostname)) {
    return isBlockedResolvedAddress(hostname)
      ? { safe: false, reason: `blocked address: ${hostname}` }
      : { safe: true, url: parsed.toString() };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { safe: false, reason: `hostname did not resolve: ${hostname}` };
  }

  const blocked: LookupAddress | undefined = addresses.find((entry: LookupAddress) =>
    isBlockedResolvedAddress(entry.address),
  );
  if (blocked !== undefined) {
    return { safe: false, reason: `hostname resolves to a blocked address: ${blocked.address}` };
  }
  return { safe: true, url: parsed.toString() };
}
