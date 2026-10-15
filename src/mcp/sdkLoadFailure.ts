/**
 * sdkLoadFailure — say WHY the MCP SDK did not load, because there are two
 * reasons and only one of them is "install it".
 *
 * ── The lie this exists to stop ──────────────────────────────────────────────
 * Every SDK load in this module used to sit behind a BARE `catch`, and a bare
 * catch cannot tell the two apart:
 *
 *   1. the package really is absent — `Cannot find module …`; and
 *   2. the LOADER is absent — `lazyRequire` reaches for `createRequire`, which
 *      exists in Node and does not exist in a browser bundle, where a bundler
 *      has externalized `node:module` to a stub.
 *
 * Case 2 raises `TypeError: nodeModule.createRequire is not a function`, and a
 * bare catch reported it as "install @modelcontextprotocol/sdk" — to a browser
 * that had the SDK installed all along. The reader then installs a package they
 * already have, watches nothing change, and concludes MCP does not work here.
 *
 * ── The contract ─────────────────────────────────────────────────────────────
 * The absent-package message is passed IN and returned VERBATIM, so the message
 * every release before this one produced is byte-identical to the one this one
 * produces. Only the second arm is new, and it names the underlying failure and
 * the seam that gets past it.
 *
 * Pattern: pure classifier. No I/O, no throwing, no vendor names beyond the
 * package it reports on. Role: Layer-3 tool transport, shared by `mcpClient`
 * and `mcpServe` so the two cannot drift into telling different stories.
 */

/**
 * Everything a load site knows about its own failure. Split out so the same
 * classifier serves seven call sites that each name a different specifier and
 * offer a different way past it.
 */
export interface SdkLoadFailureNotes {
  /**
   * The exact message this site produced before the classifier existed — the
   * absent-package case, returned unchanged. Byte-compatibility is the point:
   * a consumer scripting against that text keeps working.
   */
  readonly notInstalled: string;
  /** The function the consumer called, e.g. `'mcpClient'`. */
  readonly caller: string;
  /** The module specifier that failed to load. */
  readonly specifier: string;
  /**
   * One sentence naming what to pass instead when the LOADER, not the package,
   * is what is missing. Written per site because the answer differs: the http
   * path has `sdk` / `connection`, stdio has neither and never will.
   */
  readonly instead: string;
}

/**
 * Which of the two failures happened, as a message.
 *
 * @param err whatever the `catch` bound — an `Error`, or anything else a
 *   loader can throw.
 * @returns the absent-package message verbatim when the specifier could not be
 *   RESOLVED; otherwise a message naming the real failure and the way past it.
 */
export function sdkLoadFailure(err: unknown, notes: SdkLoadFailureNotes): string {
  const detail = detailOf(err);
  if (isModuleNotFound(detail)) return notes.notInstalled;
  return (
    `${notes.caller} could not load ${notes.specifier} through its Node loader.\n` +
    `  Underlying failure: ${detail}\n` +
    '  A browser bundle hits this: the Node `require` loader does not exist there,\n' +
    '  so the package being installed is not the question.\n' +
    `  ${notes.instead}`
  );
}

/**
 * Did the loader fail to RESOLVE the specifier?
 *
 * Matched on the message rather than on a class, because the four runtimes that
 * raise it disagree about the class: Node's CJS resolver throws `Error` with
 * `code: 'MODULE_NOT_FOUND'`, its ESM resolver `ERR_MODULE_NOT_FOUND`, esbuild's
 * `__require` shim a plain `Error`, and Vite a bare `TypeError` with neither.
 * A message test is the one thing all four share.
 *
 * Deliberately CONSERVATIVE: anything unrecognised falls to the second arm,
 * which prints the underlying failure. Guessing "not installed" is the failure
 * mode this module exists to remove, so an unknown error must never land there.
 */
function isModuleNotFound(detail: string): boolean {
  return /Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Failed to resolve|Dynamic require of/i.test(
    detail,
  );
}

/** The failure as text. Never throws — this runs inside an error path. */
function detailOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return '(an error that could not be described)';
  }
}
