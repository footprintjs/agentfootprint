/**
 * hosting/headers — one lower-casing of one header bag, shared by every door.
 *
 * A six-line helper gets its own file for the reason every other shared piece
 * in this folder does: two copies of it is how the request door and the
 * conversation door end up disagreeing about whether a header the caller sent
 * as `X-Session-Id` is present, and that disagreement would surface as one door
 * seeing a session the other cannot.
 */

import type { IncomingMessage } from 'node:http';

/**
 * Header names lower-cased, repeated values joined — the shape every wire reads
 * from, so no wire ever has to guess at casing.
 */
export function lowerCasedHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name.toLowerCase()] = value;
    else if (Array.isArray(value)) out[name.toLowerCase()] = value.join(', ');
  }
  return out;
}
