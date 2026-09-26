/**
 * hosting/signin/browserGuard — the door guard a door whose credential rides
 * along on forged browser requests must have (design §3, H1/H4).
 *
 * Built from the HOST's own lists (one source: the same `allowedHosts` /
 * `allowedOrigins` the host is given). Refused at construction:
 *  - `'any'` for either list — that says no browser reaches the door;
 *  - `requireJsonContentType: false` — a form could post to it;
 *  - no `allowedHosts` for a public URL that is not this machine;
 *  - for a door that sets a cookie on a plain-http (development) public URL, a
 *    LAN name in `allowedHosts` (a cookie without `Secure` must never be
 *    offered to another machine);
 *  - a public URL the lists themselves would refuse.
 *
 * Used by the sign-in door (its cookie) and by `proxy-token` (the proxy's
 * cookie or Windows login, turned into a header on every request it forwards).
 */

import { doorGuard, isLoopbackBind, type CrossSiteOptions, type DoorGuard } from '../doorGuard.js';
import { SignInDoorConfigError } from './errors.js';

export function browserDoorGuard(
  name: string,
  lists: CrossSiteOptions | undefined,
  url: URL,
  /** Does THIS door set a cookie without `Secure` (a plain-http development URL)? */
  insecureCookie: boolean,
): DoorGuard {
  if (lists?.allowedHosts === 'any' || lists?.allowedOrigins === 'any') {
    throw new SignInDoorConfigError(
      'guard',
      `allowedHosts/allowedOrigins 'any' says no browser reaches this door, and this door's ` +
        `credential rides along on every browser request. List the names people use`,
    );
  }
  if (lists?.requireJsonContentType === false) {
    throw new SignInDoorConfigError(
      'guard',
      `requireJsonContentType false would let a cross-site form post through this door`,
    );
  }
  if (lists?.allowedHosts === undefined && !isLoopbackBind(url.hostname)) {
    throw new SignInDoorConfigError(
      'guard',
      `the door hardening's allowedHosts is required (the same list the host uses): this door's ` +
        `credential rides along on every forged request, so the door must refuse other Host ` +
        `names and origins before identity is consulted`,
    );
  }
  if (insecureCookie && Array.isArray(lists?.allowedHosts)) {
    const lan = lists.allowedHosts.filter((h) => !isLoopbackBind(h.replace(/:\d+$/, '')));
    if (lan.length > 0) {
      throw new SignInDoorConfigError(
        'guard',
        `a plain-http public URL serves a cookie without Secure, so allowedHosts may name only ` +
          `this machine (not ${lan.join(
            ', ',
          )}). https is required for any name other machines reach`,
      );
    }
  }
  const guard = doorGuard({
    name,
    ...(lists?.allowedHosts === undefined && { bindHost: url.hostname }),
    ...(lists?.allowedHosts !== undefined && { allowedHosts: lists.allowedHosts }),
    ...(lists?.allowedOrigins !== undefined && { allowedOrigins: lists.allowedOrigins }),
  });
  const probe = guard.check({
    method: 'POST',
    headers: { host: url.host, origin: url.origin, 'content-type': 'application/json' },
  });
  if (probe !== undefined) {
    throw new SignInDoorConfigError(
      'guard',
      `the public URL ${url.origin} is refused by the door's own lists (${probe.code}). Add its ` +
        `host to allowedHosts (and its origin to allowedOrigins, when set)`,
    );
  }
  return guard;
}
