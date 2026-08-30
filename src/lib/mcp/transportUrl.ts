/**
 * transportUrl — read `transport.url` the way the runtime it is running in
 * would read it.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * `new URL('/py/mcp')` throws `TypeError: Invalid URL`. In Node that is the
 * right answer: there is no document, so there is no base, and a path on its
 * own names nothing. In a browser it is the wrong answer twice over — the page
 * HAS a base, and `/py/mcp` is the single most ordinary way to name a sidecar
 * behind the same origin (which is also how you avoid a CORS preflight
 * entirely). Before this, a browser consumer's first attempt died on a
 * `TypeError` from deep inside the transport constructor, with nothing in the
 * message naming the URL or the fix.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * An ABSOLUTE url takes the identical first branch it always took, so every
 * existing caller is byte-identical. A relative one resolves against
 * `globalThis.location.href` when there is one. With neither, the refusal says
 * which of the two worlds it is in, because "Invalid URL" does not.
 *
 * Pattern: pure function. Role: Layer-3 tool transport.
 */

/**
 * Resolve a transport URL, honouring a document base when the runtime has one.
 *
 * @param raw the `url` from an `http` or `gateway` transport descriptor
 * @param caller the function to name in the refusal, e.g. `'mcpClient'`
 * @throws when `raw` is neither absolute nor resolvable against a base
 */
export function transportUrl(raw: string, caller: string): URL {
  try {
    return new URL(raw);
  } catch {
    // Not absolute. A browser can still resolve it; Node cannot.
  }
  const base = documentBase();
  if (base !== undefined) {
    try {
      return new URL(raw, base);
    } catch {
      // A base existed and still did not help — fall through to the refusal,
      // which names both halves rather than blaming the url alone.
    }
  }
  throw new Error(
    `${caller}: transport.url ${JSON.stringify(raw)} is not an absolute URL, and ` +
      `${
        base === undefined
          ? 'this runtime has no document base to resolve it against (Node, a worker, a test)'
          : `it does not resolve against the document base ${JSON.stringify(base)}`
      }. ` +
      'Pass an absolute URL (for example `http://127.0.0.1:5230/mcp`); a path like ' +
      '`/mcp` only resolves in a browser, against the page it was loaded from.',
  );
}

/**
 * The page's own URL, when there is a page.
 *
 * Read through `globalThis` and guarded, because every access here is on a
 * host object this library does not own: `location` is absent in Node, present
 * but href-less in some worker and test doubles, and a getter that throws in a
 * sandboxed frame.
 */
function documentBase(): string | undefined {
  try {
    const href = (globalThis as { location?: { href?: unknown } }).location?.href;
    return typeof href === 'string' && href.length > 0 ? href : undefined;
  } catch {
    return undefined;
  }
}
