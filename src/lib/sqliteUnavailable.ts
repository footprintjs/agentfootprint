/**
 * lib/sqliteUnavailable — the one refusal for "this Node has no `node:sqlite`".
 *
 * Pattern: leaf error type (imports nothing).
 * Role:    shared by `hosting/sqliteSessions` and `adapters/memory/sqliteVector`.
 *          It lives here rather than in either of them because two adapters
 *          hitting the same missing module must raise the same error: a
 *          consumer catching `SqliteUnavailableError` should not have to know
 *          which of our stores was being constructed, and two classes of one
 *          name is a duplicate type the build refuses anyway.
 * Emits:   N/A.
 *
 * Node 20 does not have the module at all; Node 22.5 through 22.12 have it
 * behind `--experimental-sqlite`; Node 22.13+ and 23.4+ have it as-is (still
 * marked experimental by Node, which is why it prints a warning on first use).
 *
 * The refusal names the version you are on and the three ways out, because
 * "cannot find module 'node:sqlite'" out of a library's guts tells you what
 * broke and nothing about what to do.
 *
 * **There is deliberately no fallback.** Each caller supplies its own last
 * sentence saying what a silent fallback would have looked like from the
 * outside, because that sentence is the argument — not decoration.
 */

/** What the refusal says about the caller that raised it. */
export interface SqliteUnavailableContext {
  /** The factory the consumer actually wrote, e.g. `sqliteSessions()`. */
  readonly factory: string;
  /** The honest in-memory alternative, named so it can be reached for. */
  readonly alternative: string;
  /** Why falling back to that alternative silently would be worse than refusing. */
  readonly whyNotFallback: string;
  /** Which door the message belongs to, for the `[prefix]` tag. */
  readonly door: string;
}

const SESSIONS_CONTEXT: SqliteUnavailableContext = {
  door: 'hosting',
  factory: 'sqliteSessions()',
  alternative:
    'memorySessions() — which keeps conversations in a Map and loses them on restart, and says so in its name',
  whyNotFallback:
    'a store that silently forgot every conversation on restart looks, from the outside, exactly like a brand-new user',
};

/**
 * Raised when `node:sqlite` is not available in the running Node.
 *
 * @example
 * ```ts
 * try {
 *   const store = sqliteVectorStore({ file: './corpus.db' });
 * } catch (err) {
 *   if (err instanceof SqliteUnavailableError) {
 *     console.error(`Node ${err.nodeVersion} cannot do this`, err.message);
 *   }
 * }
 * ```
 */
export class SqliteUnavailableError extends Error {
  readonly code = 'ERR_SQLITE_UNAVAILABLE' as const;
  /** The Node version this process is running. */
  readonly nodeVersion: string;

  constructor(
    nodeVersion: string,
    reason: string,
    context: SqliteUnavailableContext = SESSIONS_CONTEXT,
  ) {
    super(
      `[${context.door}] ${context.factory} needs Node's built-in 'node:sqlite' module, and this ` +
        `process (Node ${nodeVersion}) does not have it (${reason}). ` +
        `That module ships with Node 22.5 and newer: on Node 22.13+ (and 23.4+) it is ` +
        `available as-is, and on Node 22.5–22.12 it is behind --experimental-sqlite. ` +
        `So: upgrade Node, add that flag, or use ${context.alternative}. ` +
        `This refuses rather than falling back to memory on your behalf: ` +
        `${context.whyNotFallback}.`,
    );
    this.name = 'SqliteUnavailableError';
    this.nodeVersion = nodeVersion;
  }
}
