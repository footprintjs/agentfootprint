/**
 * The code-session port's refusals and its one path rule.
 *
 * Every adapter behind the `CodeSession` port refuses the same things with the
 * same error, and reads a session path by the same rule, so a caller that
 * swaps `localCodeRunner` for `agentCoreCodeRunner` catches the same names.
 * The rule lives here, beside the port, rather than in either adapter: two
 * copies of a path rule are two rules.
 */

/** Why a code-session operation was refused. */
export type CodeSandboxRefusal =
  /** The path is absolute, climbs above the working directory, or is not a path. */
  | 'path-refused'
  /** A read found a file larger than its `maxBytes`. Nothing was returned. */
  | 'file-too-large'
  /** The backend answered a read with no file for the path. */
  | 'file-not-returned'
  /** The backend returned a file without saying which path it is. */
  | 'uri-missing'
  /** The backend returned a file for a path other than the one asked for. */
  | 'uri-mismatch'
  /** The backend returned several files for one path, or a file with both text and bytes, or neither. */
  | 'content-ambiguous'
  /** One request would be larger than the backend accepts in a single call. Nothing was sent. */
  | 'request-too-large'
  /** The backend did not confirm a write. */
  | 'write-failed'
  /** The caller's `timeoutMs` passed before the backend answered. */
  | 'timed-out'
  /** The staged-input manifest could not be set where the next run reads it. */
  | 'staged-inputs-unset';

/**
 * A code-session operation refused — before anything was sent, or because
 * what came back could not be trusted as the answer.
 *
 * Carries the path, sizes and limits as data. Never a file's contents and
 * never a command's text: those are the two things a code session holds that
 * an error message must not repeat, because error messages reach logs, traces
 * and the model.
 */
export class CodeSandboxError extends Error {
  readonly code = 'ERR_CODE_SANDBOX' as const;
  /** What was refused. */
  readonly reason: CodeSandboxRefusal;
  /** The session path involved, when there was one. */
  readonly path?: string;
  /** The size that was measured, in bytes, when the refusal is about size. */
  readonly bytes?: number;
  /** The limit that size was held to, in bytes. */
  readonly limit?: number;

  constructor(
    reason: CodeSandboxRefusal,
    message: string,
    details: { readonly path?: string; readonly bytes?: number; readonly limit?: number } = {},
  ) {
    super(message);
    this.name = 'CodeSandboxError';
    this.reason = reason;
    if (details.path !== undefined) this.path = details.path;
    if (details.bytes !== undefined) this.bytes = details.bytes;
    if (details.limit !== undefined) this.limit = details.limit;
  }
}

/** The longest stretch of a refused path a message quotes. */
const QUOTED_PATH_MAX = 200;

function quoted(path: string): string {
  const shown = path.length > QUOTED_PATH_MAX ? `${path.slice(0, QUOTED_PATH_MAX)}…` : path;
  return JSON.stringify(shown);
}

function refused(path: string, why: string): CodeSandboxError {
  return new CodeSandboxError(
    'path-refused',
    `code session: the path ${quoted(path)} ${why}. A session path is relative to the ` +
      "session's working directory and stays inside it — name the file as the session's code " +
      'would, for example `out/result.csv`.',
    { path },
  );
}

/**
 * One session path, checked and put in canonical form — THE path rule every
 * adapter applies before it reads a file.
 *
 * Refused, by name, before anything is sent:
 *   - an empty path, and one that names the working directory itself (`.`);
 *   - an absolute path (`/etc/passwd`) and a drive (`C:…`);
 *   - a leading `~`, which a shell would read as a home directory;
 *   - any backslash — a separator on one platform and an ordinary character
 *     on another, so `a\..\..\x` cannot be judged the same way everywhere;
 *   - a NUL, which ends a path early in the operating system's own calls;
 *   - a `..` that climbs above the working directory (`../x`, `a/../../x`).
 *
 * A `..` that stays inside is resolved here (`a/../b` → `b`), `.` and empty
 * segments are dropped (`./out//a.csv` → `out/a.csv`), and the result never
 * contains `..` at all — so no backend is ever handed a parent hop to
 * interpret. Lexical, not physical: on the caller's own machine a symbolic
 * link can still point elsewhere, which `localCodeRunner` checks separately.
 *
 * @throws CodeSandboxError with reason `'path-refused'`.
 */
export function sandboxPath(path: string): string {
  if (typeof path !== 'string') {
    throw refused(String(path), 'is not a string');
  }
  if (path.length === 0) throw refused(path, 'is empty');
  if (path.includes('\0')) throw refused(path, 'contains a NUL character');
  if (path.includes('\\')) {
    throw refused(
      path,
      'contains a backslash, which is a separator on one platform and an ordinary character on another',
    );
  }
  if (path.startsWith('/')) throw refused(path, 'is absolute');
  if (/^[A-Za-z]:/.test(path)) throw refused(path, 'names a drive');
  if (path.startsWith('~'))
    throw refused(path, "starts with '~', which a shell reads as a home directory");
  const kept: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (kept.length === 0) throw refused(path, 'climbs above the working directory');
      kept.pop();
      continue;
    }
    kept.push(segment);
  }
  if (kept.length === 0) throw refused(path, 'names the working directory itself, not a file');
  return kept.join('/');
}

/**
 * The one check of a `maxBytes` bound: a positive whole number, or a
 * `TypeError` naming the option. A read with no bound, or with a bound of
 * zero, is a programming error rather than a file that happened to be large.
 */
export function readBound(options: { readonly maxBytes?: unknown } | undefined): number {
  const maxBytes = options?.maxBytes;
  if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError(
      'code session: readFile needs `maxBytes`, a positive whole number of bytes — a read names ' +
        'its bound, and a file over it is refused rather than cut.',
    );
  }
  return maxBytes;
}
