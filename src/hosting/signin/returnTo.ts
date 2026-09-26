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
 *     not the input, is what gets sealed and redirected to.
 *  4. Anything refused becomes `/`.
 */

/** The safe place to send the browser: a same-origin path, or `/`. */
export function safeReturnTo(input: unknown, publicUrl: URL): string {
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
  return kept.startsWith('/') && !kept.startsWith('//') ? kept : '/';
}
