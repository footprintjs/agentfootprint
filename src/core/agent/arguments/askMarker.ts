/**
 * arguments/askMarker — how a reader recognises the inputs layer's OWN ask,
 * without loading the ask.
 *
 * Pattern: Map leaf. The reserved `context` key, its kind, the one reader of
 *          them, and what the resume event may carry of an answer to it.
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2). Kept apart
 *          from `ask.ts` — which loads through `import()` only when an ask is
 *          raised (`test/lib/trace-toolpack/browserGraph.test.ts`) — so a
 *          reader on every agent's graph (`RunnerBase` · `emitPauseResume`)
 *          can ask "was this pause the library's argument ask?" without
 *          pulling the ask onto that graph.
 * Emits:   N/A.
 *
 * ## Why the resume event never carries the answer
 *
 * The person's answer to the library's ask fills arguments a tool's own view
 * may hide (`core/toolShownArgs.ts` · `shownArgsOf`), and the layer's law is
 * that such a value appears on no row, no event, no served note and no ask
 * context. The `agentfootprint.pause.resume` event carries the reply it
 * resumed with, and every recording keeps that event. So for this ask the
 * event carries the reply's SHAPE — the request id, the field ids — with each
 * value read as `'REDACTED'`. The `answered` rows and their events already
 * carry what each tool's view allows.
 */

import { HIDDEN_VALUE } from './rows.js';

/** The reserved key of the ask's `context` — the library's marker. */
export const ASK_CONTEXT_KEY = 'agentfootprint';
/** What the reserved key says this ask is. */
export const ARGUMENT_ASK_KIND = 'arguments';

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether an ask `context` carries the library's own marker (`{ agentfootprint: { ask: 'arguments' } }`). */
export function isArgumentAskContext(context: unknown): boolean {
  if (!isObject(context)) return false;
  const marker = context[ASK_CONTEXT_KEY];
  return isObject(marker) && marker.ask === ARGUMENT_ASK_KIND;
}

/**
 * Whether a pause's data is the inputs layer's own ask — read off
 * `pauseData.awaitingInput.context`, whatever else the data holds, and never
 * throwing on a shape it does not know (a reader of every pause kind must not
 * fail on one).
 */
export function isArgumentAskPause(pauseData: unknown): boolean {
  if (!isObject(pauseData)) return false;
  const awaiting = pauseData.awaitingInput;
  return isObject(awaiting) && isArgumentAskContext(awaiting.context);
}

/** Keys of a reply that carry no answer — kept as they are on the event. */
const SHAPE_KEYS: ReadonlySet<string> = new Set([
  'status',
  'requestId',
  'origins',
  'origin',
  'context',
  'cancel',
]);

/**
 * The reply to the library's ask as the resume event may carry it: the request
 * id, the status, the origins and the field ids, with every answered value —
 * and anything the reply carries that is not one of those keys — read as
 * `'REDACTED'`. A reply that is not an object is itself the answer, so it is
 * redacted whole.
 *
 * @example
 * ```ts
 * argumentAskReplyForEvent({ requestId: 'r1', values: { f1: 'ACCT-99' } });
 * // { requestId: 'r1', values: { f1: 'REDACTED' } }
 * ```
 */
export function argumentAskReplyForEvent(reply: unknown): Readonly<Record<string, unknown>> {
  if (!isObject(reply)) return { input: HIDDEN_VALUE };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(reply)) {
    if (key === 'values' && isObject(value)) {
      out.values = Object.fromEntries(Object.keys(value).map((id) => [id, HIDDEN_VALUE]));
    } else {
      out[key] = SHAPE_KEYS.has(key) ? value : HIDDEN_VALUE;
    }
  }
  return out;
}
