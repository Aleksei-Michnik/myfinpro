/**
 * Phase 7.10 — SSRF guard for URL-ingested receipts.
 *
 * A receipt URL is user-supplied and later fetched server-side, so it must
 * be a *public* http(s) resource. We reject non-http schemes, embedded
 * credentials, loopback / internal hostnames, and IP literals inside
 * loopback / private / link-local (incl. the cloud metadata address) /
 * CGNAT / multicast ranges. Applied at ingestion (POST /receipts/url → 400)
 * and again per redirect hop in the fetcher.
 *
 * Known limitation: a public hostname that *resolves* to a private address
 * (DNS rebinding) is not caught here — that needs connection-time IP pinning
 * and is out of scope for this iteration.
 */

export class UnsafeReceiptUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeReceiptUrlError';
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

/** Validate a URL string; returns the parsed URL or throws UnsafeReceiptUrlError. */
export function assertPublicReceiptUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeReceiptUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeReceiptUrlError('Only http(s) URLs are allowed');
  }
  if (url.username || url.password) {
    throw new UnsafeReceiptUrlError('URLs with embedded credentials are not allowed');
  }

  // url.hostname keeps IPv6 brackets in some runtimes — strip them.
  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!host) {
    throw new UnsafeReceiptUrlError('URL has no host');
  }
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new UnsafeReceiptUrlError('Loopback / internal hosts are not allowed');
  }

  const v4 = parseIpv4(host);
  if (v4) {
    if (isPrivateIpv4(v4)) throw new UnsafeReceiptUrlError('Non-public IP address');
    return url;
  }
  if (host.includes(':') && isPrivateIpv6(host)) {
    throw new UnsafeReceiptUrlError('Non-public IP address');
  }
  return url;
}

/** Parse a dotted-quad IPv4 literal to its four octets, or null if not IPv4. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1, 5).map((s) => Number(s));
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return octets as [number, number, number, number];
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isPrivateIpv6(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase();
  if (host === '::1' || host === '::') return true; // loopback / unspecified

  // IPv4-mapped (::ffff:a.b.c.d) — runtimes may keep the dotted form or
  // canonicalize it to two hex groups (::ffff:7f00:1). Handle both.
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (dotted) {
    const v4 = parseIpv4(dotted[1]);
    return v4 ? isPrivateIpv4(v4) : true;
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }

  if (/^f[cd]/.test(host)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
  return false;
}
