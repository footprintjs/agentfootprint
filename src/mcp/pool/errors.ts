/**
 * errors — the pool's two refusals, each one fixed sentence.
 *
 * Pattern: typed errors whose message reaches the model and whose fields reach
 *          the app.
 * Role:    A refusal comes before the `tools/call` is sent, and says so
 *          (`sent: false`) for the record of what that attempt did. Control
 *          requests made on the way — the `initialize` of a replacement client,
 *          a revalidating `tools/list` — may already have reached the server;
 *          `sent` describes the `tools/call` only.
 *
 * A message is a fixed sentence per reason. It names no identity, no key, no
 * session and no count: the counts ride typed fields the app reads, and the
 * original error of a failed open rides `cause`, for the app, never composed
 * into the message.
 */

/** Why a pool refused, by name. */
export type McpPoolRefusal =
  | 'no-identity'
  | 'incomplete-identity'
  | 'identity-mismatch'
  | 'init-timeout'
  | 'init-failed'
  | 'stale-tools'
  | 'binding-changed'
  | 'lease-expired'
  | 'closed';

/** The sentence each refusal reaches the model as. */
export const MCP_POOL_REFUSAL_SENTENCES: Readonly<Record<McpPoolRefusal, string>> = Object.freeze({
  'no-identity':
    "This tool needs the caller's identity and none was named, so the call this result answers was not sent.",
  'incomplete-identity':
    'This tool needs a complete caller identity and the one named is incomplete, so the call this result answers was not sent.',
  'identity-mismatch':
    'This tool was listed for another conversation, so the tool call was not sent.',
  'init-timeout':
    'The connection to this server did not open in time, so the tool call was not sent.',
  'init-failed':
    'The connection to this server could not be opened, so the tool call was not sent.',
  'stale-tools':
    "This tool's definition is no longer current, so the tool call was not sent. List the tools again.",
  'binding-changed':
    'This tool was listed for another configuration of this server, so the tool call was not sent. List the tools again.',
  'lease-expired': 'This connection lease has expired, so the tool call was not sent.',
  closed: 'The connection pool for this server is closed, so the tool call was not sent.',
});

/**
 * The pool refused before the `tools/call` was sent — by `reason`.
 *
 * `init-failed` keeps the open's own error as `cause`, for the app; its text is
 * never in the message.
 */
export class McpPoolRefusedError extends Error {
  readonly code = 'ERR_MCP_POOL_REFUSED' as const;
  /** The `tools/call` was not sent. Control requests on the way may have been. */
  readonly sent = false as const;

  constructor(
    readonly reason: McpPoolRefusal,
    /** The pool's name: the server. */
    readonly server: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(MCP_POOL_REFUSAL_SENTENCES[reason], {
      ...(options.cause !== undefined && { cause: options.cause }),
    });
    this.name = 'McpPoolRefusedError';
  }
}

/** Which budget was full. */
export type McpPoolLimit = 'pool' | 'principal' | 'ending' | 'operations';

/** The one sentence a full pool reaches the model as. */
export const POOL_FULL_SENTENCE =
  'The connection pool for this server was full, so the tool call was not sent.';

/**
 * A budget was full, so the work was refused at once — there is no queue. Its
 * scope is the `tools/call`, as with `sent: false`. The counts ride typed fields.
 */
export class PoolFullError extends Error {
  readonly code = 'ERR_MCP_POOL_FULL' as const;
  readonly sent = false as const;

  constructor(
    /** The pool's name: the server. */
    readonly server: string,
    /** Which budget was full. */
    readonly limit: McpPoolLimit,
    /** That budget's size. */
    readonly max: number,
    /** Busy clients when it was refused. */
    readonly busy: number,
    /** Clients being ended when it was refused. */
    readonly ending: number,
    /** Operations charged when it was refused. */
    readonly operations: number,
  ) {
    super(POOL_FULL_SENTENCE);
    this.name = 'PoolFullError';
  }
}
