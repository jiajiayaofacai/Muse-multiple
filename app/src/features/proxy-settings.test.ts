import { describe, expect, it } from 'vitest';
import { parseProxyEndpoint } from './proxy-settings';

describe('代理端点解析', () => {
  it('accepts a complete HTTPS proxy URL and extracts TLS scheme, host and explicit port', () => {
    expect(parseProxyEndpoint('http', 'https://secure-proxy.example:7161', '')).toEqual({
      ok: true,
      value: { enabled: true, scheme: 'https', host: 'secure-proxy.example', port: 7161 },
    });
  });
  it('accepts split settings and supplies protocol default port for a URL', () => {
    expect(parseProxyEndpoint('https', 'https://proxy.example', '')).toEqual({
      ok: true,
      value: { enabled: true, scheme: 'https', host: 'proxy.example', port: 443 },
    });
    expect(parseProxyEndpoint('socks5', 'proxy.example', '1080')).toEqual({
      ok: true,
      value: { enabled: true, scheme: 'socks5', host: 'proxy.example', port: 1080 },
    });
  });
  it('accepts IPv6 endpoints and rejects credentials, paths and unsupported schemes', () => {
    expect(parseProxyEndpoint('https', 'https://[2001:db8::1]:9443', '')).toEqual({
      ok: true,
      value: { enabled: true, scheme: 'https', host: '2001:db8::1', port: 9443 },
    });
    for (const endpoint of ['https://user:secret@proxy.example:443', 'https://proxy.example/path', 'ftp://proxy.example:21', 'https://proxy.example:70000']) {
      expect(parseProxyEndpoint('http', endpoint, '').ok, endpoint).toBe(false);
    }
  });
});
