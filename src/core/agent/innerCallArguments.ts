/**
 * innerCallArguments — the ONE reading of what a composing tool handed
 * `ctx.tools.call(name, args)` as arguments.
 *
 * Role: core/agent, beside `toolDispatch.ts`. A leaf: it reads its argument.
 *
 * WHY A COPY, TAKEN AT ONCE. On a call the model makes, the arguments are the
 * library's own parse of the model's text: nobody else holds them. On an inner
 * call the composing tool holds the object it passed, and keeps running while
 * the gates are awaited. A checker that approved `{ account: 'ok' }` must not
 * see the tool run on `{ account: 'A1' }` because the composer wrote into its
 * object in between (or reused one object for several calls in a loop). So
 * the inner call takes ONE detached copy (`structuredClone`) synchronously,
 * before its first await, and the gates, the refusals, the record and the tool
 * are all handed that copy.
 *
 * WHAT IS REFUSED, and why. Tool arguments are the input schema's object.
 *   - Not an object (a string, a number, an array, `null`): refused with the
 *     schema check's own sentence, whether or not a gate is configured — no
 *     gate is asked about a call that cannot run, and no gate's answer turns
 *     it into `{}`.
 *   - An object `structuredClone` refuses (it holds a function, a symbol, a
 *     foreign proxy): refused, because no copy can be judged and held still.
 *   - `undefined` (no arguments given) reads as `{}`, the empty object.
 *
 * Example:
 *   takeArguments({ account: 'A1' }) // { kind: 'copied', args: { account: 'A1' } } — a new object
 *   takeArguments('A1')              // { kind: 'not-object' }
 *   takeArguments({ run: () => 1 })  // { kind: 'not-copyable' }
 */

import type { ToolArgs } from '../../tools/runChain.js';
import {
  formatToolArgIssues,
  typeNameOf,
  validateToolArgs,
} from '../../tools/toolArgsValidation.js';

/** What the composing tool's arguments turned out to be. */
export type TakenArguments =
  | { readonly kind: 'copied'; readonly args: ToolArgs }
  | { readonly kind: 'not-object' }
  | { readonly kind: 'not-copyable' };

/** Whether `value` is an argument object: a non-null, non-array object. */
export function isArgumentObject(value: unknown): value is ToolArgs {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Take the inner call's one detached copy. Synchronous on purpose (see the header). */
export function takeArguments(args: unknown): TakenArguments {
  if (args === undefined) return { kind: 'copied', args: {} };
  if (!isArgumentObject(args)) return { kind: 'not-object' };
  try {
    return { kind: 'copied', args: structuredClone(args) };
  } catch {
    return { kind: 'not-copyable' };
  }
}

/**
 * The refusal for arguments that are not an object: the schema check's own
 * sentence (`Invalid arguments for tool '…' — the call was not executed …`),
 * the one a model's malformed call reads. A schema that does not itself say
 * `type: 'object'` is held to it all the same: tool arguments are an object.
 */
export function notObjectRefusal(
  name: string,
  args: unknown,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): string {
  const own = validateToolArgs(args, inputSchema);
  const issues = own.ok ? [{ path: '', expected: 'object', got: typeNameOf(args) }] : own.issues;
  return formatToolArgIssues(name, issues);
}

/** The refusal for arguments no copy can be made of. */
export function notCopyableRefusal(name: string): string {
  return (
    `ctx.tools.call('${name}'): its arguments could not be copied (they hold a function, a ` +
    `symbol or another value structuredClone refuses), and an inner call runs only on a ` +
    `copy the gates judged — the tool did not run. Pass plain data.`
  );
}
