/**
 * hosting/signin/returnTo — where a sign-in sends the browser afterwards, and
 * why it can never be off the public origin (design §5.5; RFC 9700 §4.11.1:
 * "Clients MUST NOT expose open redirectors").
 *
 * Written down so nobody improvises "starts with `/`", which passes
 * `//evil.example`, `/\evil.example` (browsers read `\` as `/`) and
 * `/<TAB>/evil.example` (the URL parser drops tab, CR and LF):
 *
 *  1. Only a relative path: exactly one leading `/`; no `\` and no control
 *     character anywhere in the raw input; never an absolute URL, even one
 *     naming our own origin.
 *  2. Resolved against the public URL anyway, and refused unless the result's
 *     origin IS the public origin — a second check for a parser quirk step 1
 *     missed.
 *  3. Only the re-serialised `pathname + search + hash` is kept: that string,
 *     not the input, is what gets sealed and redirected to. It must still
 *     start with exactly one `/`: dot segments (`/.//evil.example`,
 *     `/%2e%2e//evil.example`) resolve to the pathname `//evil.example`, a
 *     protocol-relative redirect — this check is their only guard.
 *  4. The KEPT form is at most 512 bytes (review idI57 S-2): it rides in a
 *     sealed cookie, and percent-encoding can grow 900 raw characters to
 *     5 KB, past a browser's per-cookie cap.
 *  5. Never the door itself (`/auth/login` would loop through a silent-SSO
 *     IdP, minting a sign-in per lap — review idI57 N-3).
 *  6. Anything refused becomes `/`.
 */

/** The longest kept `returnTo`, in bytes after encoding. */
export const MAX_RETURN_TO_BYTES = 512;

/**
 * The safe place to send the browser: a same-origin path, or `/`.
 * `doorPrefix` (the sign-in door's, `/auth`): a path under it becomes `/`.
 */
export function safeReturnTo(input: unknown, publicUrl: URL, doorPrefix?: string): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) return '/';
  if (!input.startsWith('/') || input.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(input)) return '/';
  let resolved: URL;
  try {
    resolved = new URL(input, publicUrl.origin);
  } catch {
    return '/';
  }
  if (resolved.origin !== publicUrl.origin) return '/';
  const kept = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  if (!kept.startsWith('/') || kept.startsWith('//')) return '/';
  if (Buffer.byteLength(kept, 'utf8') > MAX_RETURN_TO_BYTES) return '/';
  if (doorPrefix !== undefined && underPrefix(resolved.pathname, doorPrefix)) return '/';
  return kept;
}

function underPrefix(pathname: string, prefix: string): boolean {
  const lower = pathname.toLowerCase();
  const door = prefix.toLowerCase();
  return lower === door || lower.startsWith(`${door}/`);
}
