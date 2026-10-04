import { describe, expect, it } from 'vitest';
import { validateTargetUrl } from './url-safety';

describe('validateTargetUrl (SSRF Shield Specification)', () => {
  describe('Protocol Validation', () => {
    it('allows valid http and https URLs', () => {
      expect(validateTargetUrl('https://example.com/page')).toEqual({
        safe: true,
        url: 'https://example.com/page',
      });
      expect(validateTargetUrl('http://example.com/')).toEqual({
        safe: true,
        url: 'http://example.com/',
      });
    });

    it('rejects unsupported protocols (file, ftp, gopher, javascript)', () => {
      expect(validateTargetUrl('file:///etc/passwd')).toEqual({
        safe: false,
        reason: 'unsupported protocol: file:',
      });
      expect(validateTargetUrl('ftp://example.com/resource')).toEqual({
        safe: false,
        reason: 'unsupported protocol: ftp:',
      });
      expect(validateTargetUrl('javascript:alert(1)')).toEqual({
        safe: false,
        reason: 'unsupported protocol: javascript:',
      });
    });
  });

  describe('Credential Validation', () => {
    it('rejects URLs with embedded username or password', () => {
      expect(validateTargetUrl('https://admin:secret@example.com/')).toEqual({
        safe: false,
        reason: 'credentials in url are not allowed',
      });
      expect(validateTargetUrl('https://admin@example.com/')).toEqual({
        safe: false,
        reason: 'credentials in url are not allowed',
      });
    });
  });

  describe('Hostname and Localhost/Internal Suffix Validation', () => {
    it('rejects localhost and reserved local/internal domains', () => {
      expect(validateTargetUrl('http://localhost:3000/')).toEqual({
        safe: false,
        reason: 'blocked hostname: localhost',
      });
      expect(validateTargetUrl('http://service.localhost/')).toEqual({
        safe: false,
        reason: 'blocked hostname suffix: .localhost',
      });
      expect(validateTargetUrl('http://internal.service.local/')).toEqual({
        safe: false,
        reason: 'blocked hostname suffix: .local',
      });
      expect(validateTargetUrl('http://cluster.internal/')).toEqual({
        safe: false,
        reason: 'blocked hostname suffix: .internal',
      });
      expect(validateTargetUrl('http://home.home.arpa/')).toEqual({
        safe: false,
        reason: 'blocked hostname suffix: .home.arpa',
      });
    });

    it('rejects numeric, hex, or direct IP hostnames to prevent IP bypass and force domain names', () => {
      expect(validateTargetUrl('http://2130706433/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 127.0.0.1',
      });
      expect(validateTargetUrl('http://0x7f000001/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 127.0.0.1',
      });
    });
  });

  describe('Direct IP Range Validation', () => {
    it('rejects all direct IPv4 addresses directly in URL', () => {
      expect(validateTargetUrl('http://127.0.0.1/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 127.0.0.1',
      });
      expect(validateTargetUrl('http://10.0.0.1/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 10.0.0.1',
      });
      expect(validateTargetUrl('http://192.168.1.1/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 192.168.1.1',
      });
      expect(validateTargetUrl('http://172.16.0.1/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 172.16.0.1',
      });
      expect(validateTargetUrl('http://169.254.169.254/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 169.254.169.254',
      });
      expect(validateTargetUrl('http://8.8.8.8/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 8.8.8.8',
      });
    });

    it('rejects direct IPv6 addresses', () => {
      expect(validateTargetUrl('http://[::1]/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: ::1',
      });
      expect(validateTargetUrl('http://[fc00::1]/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: fc00::1',
      });
      expect(validateTargetUrl('http://[2001:4860:4860::8888]/')).toEqual({
        safe: false,
        reason: 'direct IP hostnames are not allowed: 2001:4860:4860::8888',
      });
    });
  });

  describe('Malformed and Edge Cases', () => {
    it('rejects non-string, empty, or oversized input', () => {
      expect(validateTargetUrl(null)).toEqual({
        safe: false,
        reason: 'url must be a syntactically valid URL',
      });
      expect(validateTargetUrl('')).toEqual({
        safe: false,
        reason: 'url must be a syntactically valid URL',
      });
      expect(validateTargetUrl('https://' + 'a'.repeat(3000))).toEqual({
        safe: false,
        reason: 'url must be a syntactically valid URL',
      });
    });
  });
});
