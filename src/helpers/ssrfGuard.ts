import dns from 'node:dns';
import net from 'node:net';
import AppError from './AppError';

/**
 * Guards against SSRF: a user gives a URL that the server then fetches (a proxy
 * rotation endpoint, a custom AI base URL). Without a check, that URL can point
 * at the server's own network — cloud metadata (169.254.169.254), the database,
 * Qdrant, other internal services — and the server would happily reach them.
 *
 * This allows only http/https to a host that resolves entirely to public
 * addresses. It closes the obvious holes; it is not a defence against a
 * deliberate DNS-rebinding attacker (the address can change between this check
 * and the actual request), so keep it as one layer, not the only one.
 */

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true; // loopback
    if (p[0] === 0) return true; // "this" network
    if (p[0] === 169 && p[1] === 254) return true; // link-local / cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
  if (v.startsWith('fe80')) return true; // link-local
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

/**
 * Throws AppError(400) unless `raw` is an http/https URL whose host resolves
 * only to public addresses. Callers use it at save time (reject a bad URL up
 * front) and again just before the request (defence in depth).
 */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('That URL is not valid.', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('Only http and https URLs are allowed.', 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // An explicit escape hatch: hosts the operator has vouched for (a local test
  // provider, a deliberately internal endpoint). Empty in production, so the
  // full guard applies there.
  const allowed = (process.env.SSRF_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.includes(host)) return;
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new AppError('That host is not allowed.', 400);
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new AppError('That address points at a private network and is not allowed.', 400);
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new AppError('That host could not be resolved.', 400);
  }
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw new AppError('That host resolves to a private address and is not allowed.', 400);
  }
}
