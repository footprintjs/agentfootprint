/**
 * hosting/signin/clientAddress — which client a request came from, for the
 * per-address attempt budget.
 *
 * The socket's address, unless the peer is a TRUSTED proxy: then the rightmost
 * `X-Forwarded-For` hop that is not itself trusted (a client can prepend any
 * hops it likes; only the ones our own proxies appended are believed).
 * `X-Forwarded-For` from anybody else is ignored.
 *
 * `trustedProxies` entries are IP literals or CIDR ranges (`10.0.0.0/8`,
 * `fd00::/8`), matched as ranges — anything else is refused at construction,
 * so a typo cannot quietly match nothing.
 */

import { BlockList, isIP } from 'node:net';

import type { IncomingMessage } from 'node:http';

import { SignInDoorConfigError } from './errors.js';

export interface TrustedProxies {
  has(address: string): boolean;
  /** Were any configured? */
  readonly configured: boolean;
}

/** Parse `trustedProxies`, or refuse the first entry that is not an IP or a CIDR range. */
export function trustedProxies(entries: readonly string[] | undefined): TrustedProxies {
  const list = new BlockList();
  for (const raw of entries ?? []) {
    const entry = typeof raw === 'string' ? raw.trim() : '';
    const [ip, bits, extra] = entry.split('/');
    const family = isIP(ip ?? '');
    const prefix = bits === undefined ? undefined : Number(bits);
    const max = family === 6 ? 128 : 32;
    if (
      family === 0 ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!Number.isInteger(prefix) || prefix < 0 || prefix > max || bits === ''))
    ) {
      throw new SignInDoorConfigError(
        'trustedProxies',
        `trustedProxies entry ${JSON.stringify(raw)} is not an IP address or a CIDR range ` +
          `(e.g. 10.0.0.5, 10.0.0.0/8, fd00::/8)`,
      );
    }
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(ip as string, type);
    else list.addSubnet(ip as string, prefix, type);
  }
  const configured = (entries ?? []).length > 0;
  return {
    configured,
    has(address) {
      const family = isIP(address);
      if (family === 0) return false;
      return list.check(address, family === 6 ? 'ipv6' : 'ipv4');
    },
  };
}

/**
 * The client address. `forwardedUnset` is called when a request carries
 * `X-Forwarded-For` and no proxy is trusted — the door warns once that every
 * person behind that proxy then shares one address budget.
 */
export function clientAddress(
  req: IncomingMessage,
  trusted: TrustedProxies,
  forwardedUnset?: () => void,
): string {
  const peer = normaliseAddress(req.socket?.remoteAddress ?? 'unknown');
  const header = req.headers['x-forwarded-for'];
  if (!trusted.has(peer)) {
    if (header !== undefined && !trusted.configured) forwardedUnset?.();
    return peer;
  }
  const hops = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',')
    .map((h) => normaliseAddress(withoutPort(h.trim())))
    .filter((h) => h.length > 0);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i] as string;
    if (!trusted.has(hop)) return hop;
  }
  return peer;
}

/**
 * A forwarded hop without its port: some proxies send `1.2.3.4:5678` or
 * `[2001:db8::1]:5678`, and a port per source connection would make every
 * attempt a new address, so the delay never grew (review idI57 N-11).
 */
function withoutPort(hop: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(hop);
  if (bracketed !== null) return bracketed[1] as string;
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(hop);
  return v4 !== null ? (v4[1] as string) : hop;
}

function normaliseAddress(address: string): string {
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}
