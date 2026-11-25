import type { ProxySettingsDto } from '../../contracts/workspace';

export type ProxyEndpointResult = { ok: true; value: ProxySettingsDto } | { ok: false; message: string };
const schemes = new Set<ProxySettingsDto['scheme']>(['http', 'https', 'socks5']);
const defaultPorts: Record<ProxySettingsDto['scheme'], number> = { http: 80, https: 443, socks5: 1080 };
const invalid = (message: string): ProxyEndpointResult => ({ ok: false, message });
const isScheme = (value: string): value is ProxySettingsDto['scheme'] => schemes.has(value as ProxySettingsDto['scheme']);

export function parseProxyEndpoint(scheme: string, hostInput: string, portInput: string): ProxyEndpointResult {
  const input = hostInput.trim();
  let selected = scheme;
  let host = input;
  let port: number;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    let endpoint: URL;
    try { endpoint = new URL(input); } catch { return invalid('代理地址格式无效。'); }
    selected = endpoint.protocol.slice(0, -1).toLowerCase();
    const rest = input.slice(input.indexOf('://') + 3);
    const suffixAt = rest.search(/[/?#]/);
    const suffix = suffixAt < 0 ? '' : rest.slice(suffixAt);
    const authority = suffixAt < 0 ? rest : rest.slice(0, suffixAt);
    if (authority.includes('@') || (suffix !== '' && suffix !== '/') || endpoint.search || endpoint.hash) {
      return invalid('代理地址不能包含用户名、密码、路径、查询参数或片段。');
    }
    if (!isScheme(selected)) return invalid('仅支持 HTTP CONNECT、HTTPS（TLS代理）和 SOCKS5。');
    host = endpoint.hostname.replace(/^\[|\]$/g, '');
    port = endpoint.port ? Number(endpoint.port) : defaultPorts[selected];
  } else {
    if (input.includes('://')) return invalid('代理地址格式无效。');
    if (!isScheme(selected)) return invalid('仅支持 HTTP CONNECT、HTTPS（TLS代理）和 SOCKS5。');
    port = portInput.trim() ? Number(portInput) : defaultPorts[selected];
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return invalid('请填写有效的代理主机和 1–65535 端口。');
  }
  return { ok: true, value: { enabled: true, scheme: selected, host, port } };
}
