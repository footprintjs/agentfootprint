/**
 * callMarker — a library-private marker that ties one MCP tool call to the one
 * request the SDK sends for it, whatever the SDK copies on the way.
 *
 * Pattern: mark at the call, take at the transport.
 * Role:    The correlation hop of the request ledger (`requestLedger.ts`). The
 *          call puts its marker in the request's own `_meta` bag
 *          (`markParams`); the MCP SDK carries `_meta` through to the
 *          transport — the very object, or a copy of it (`structuredClone`, a
 *          spread) — and the ledger's watched `send` takes the marker out again
 *          (`takeMarker`) before the transport serializes the request. The
 *          server receives the bytes it always did: the marker never leaves the
 *          client.
 *
 * An object's identity does not survive a copy; a string inside it does. So an
 * SDK that copies the params still delivers the marker, and the request is
 * matched to its call by the call's own word, never by guessing from content
 * (two calls with the same arguments are the case content matching gets wrong).
 * An SDK that rebuilds the params and drops `_meta` delivers nothing: the
 * request then matches no call, and the ledger says so (`requestLedger.ts`).
 */

/** The `_meta` key the marker rides under. Never sent: `takeMarker` removes it. */
export const CALL_MARKER_KEY = 'agentfootprint/call-ref';

/**
 * `params` with `marker` added to its `_meta` bag: a new object, with every
 * other key in its place; `params` itself is not changed. A `_meta` that was
 * absent is added, after the other keys, so `takeMarker` can remove it whole.
 */
export function markParams<P extends object>(params: P, marker: string): P {
  const meta = recordOf((params as { readonly _meta?: unknown })._meta) ?? {};
  return { ...params, _meta: { ...meta, [CALL_MARKER_KEY]: marker } };
}

/** What `takeMarker` found: the marker, when the message carried one, and the message to send. */
export interface TakenMarker {
  readonly marker?: string;
  /** The message without the marker, or the message itself when it carried none. */
  readonly message: unknown;
}

/**
 * The marker a JSON-RPC message carries in `params._meta`, and the message
 * without it. The message is never changed in place: the SDK's object stays
 * the SDK's. Without the marker, the params are what they were before
 * `markParams`: a `_meta` the marker alone filled is removed, and any other
 * entry, the SDK's own included, keeps its place.
 */
export function takeMarker(message: unknown): TakenMarker {
  const fields = recordOf(message);
  const params = recordOf(fields?.['params']);
  const meta = recordOf(params?.['_meta']);
  if (
    fields === undefined ||
    params === undefined ||
    meta === undefined ||
    !Object.prototype.hasOwnProperty.call(meta, CALL_MARKER_KEY)
  ) {
    return { message };
  }
  const { [CALL_MARKER_KEY]: marker, ...rest } = meta;
  // A copy keeps every key in its place: `_meta` is replaced where it stood, or
  // removed when the marker alone filled it.
  const unmarked: Record<string, unknown> = { ...params };
  if (Object.keys(rest).length > 0) unmarked['_meta'] = rest;
  else delete unmarked['_meta'];
  return {
    ...(typeof marker === 'string' && { marker }),
    message: { ...fields, params: unmarked },
  };
}

/** A plain object's own fields, or `undefined` for anything else. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
