/**
 * displayName — the ONE rule for a tool's `displayName` (the app's own words
 * for what a call of the tool does, read by a person), and the ONE way the
 * library names a set of calls in those words: the declared ones named, the
 * rest counted.
 *
 * Pattern: two pure functions and one small reader, no state.
 * Role:    Leaf. Asked for the RULE by `tools/tools.ts` · `defineTool` and by
 *          the registration funnel (`core/agent/buildToolRegistry.ts`), and for
 *          the NAMING by the two texts the library appends after an answer —
 *          the standing line (`core/agent/assessment/compose.ts`) and the
 *          limits block (`semantics/coverage/answer.ts`). Those two cannot
 *          import each other, so the naming lives here and they cannot name
 *          the same calls in two different ways.
 * Emits:   N/A.
 *
 * ## Why only the app's words
 *
 * A tool's registered name is the MODEL's vocabulary (`load_attachment`), and
 * an app may forbid showing it to the people it serves. Nothing here ever
 * prints it: a call is named only by the words its tool declared, and a call
 * whose tool declared none is counted ("and 1 other call"), never named. A
 * caller that gets `undefined` back says what it always said.
 *
 * ## Why the plain-line rule
 *
 * The words reach a person verbatim, after an answer, so they are held to the
 * rule every declared label a report prints is held to (`lib/plainLine.ts` ·
 * `plainLineProblem`: no control, line or paragraph separator, or invisible
 * format character — a bidi override would reverse what the person reads),
 * judged BEFORE the length, and capped at the 60 characters a skill's `title`
 * and an account label are capped at.
 */

import { plainLineProblem } from './plainLine.js';

/** The longest display name a person reads — the cap every declared label a report prints has. */
export const MAX_DISPLAY_NAME_CHARS = 60;

/**
 * At most this many declared names in one phrase; any further call is counted
 * with the calls whose tools declared none. A line for a person, not a list.
 */
export const MAX_NAMED_CALLS = 3;

/**
 * Why `value` is not a display name, or `undefined` when it is — judged on the
 * trimmed text (the text a person would read). `label` names the field in the
 * sentence, so a refusal says where it was written.
 */
export function displayNameProblem(label: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return (
      `${label} must be a non-empty string — the app's own words for what a call of this ` +
      `tool does, read by a person (got ${
        typeof value === 'string' ? JSON.stringify(value) : typeof value
      }). Omit it to ` +
      'leave the call unnamed.'
    );
  }
  const text = value.trim();
  const notPlain = plainLineProblem(label, text);
  if (notPlain !== undefined) return notPlain;
  if (text.length > MAX_DISPLAY_NAME_CHARS) {
    return `${label} is ${text.length} characters; the limit is ${MAX_DISPLAY_NAME_CHARS}.`;
  }
  return undefined;
}

/**
 * The display name a person may read — trimmed — or `undefined`. A value the
 * rule refuses is never printed: a tool assembled by hand, or served by a
 * ToolProvider after the agent was built, is read through this too.
 */
export function readDisplayName(value: unknown): string | undefined {
  return displayNameProblem('displayName', value) === undefined
    ? (value as string).trim()
    : undefined;
}

/**
 * The calls, named in the app's words — each distinct declared name once, in
 * the calls' order, at most {@link MAX_NAMED_CALLS}; every other call counted,
 * with `alsoUnnamed` (calls the record does not name at all). `calls` holds one
 * entry per CALL (the caller has already said each call once), each with its
 * tool's registered name — the key a declared name is looked up by, never
 * printed:
 *
 * - `loading the attached data`
 * - `loading the attached data and searching the catalog`
 * - `loading the attached data and 1 other call`
 *
 * `undefined` when no call's tool declared a name: the caller then says what
 * it always said — the registered name is never the fallback.
 *
 * @example
 * ```ts
 * namedCalls(
 *   [{ toolCallId: 'c1', toolName: 'load_attachment' }, { toolCallId: 'c2', toolName: 'list_runs' }],
 *   0,
 *   (tool) => (tool === 'load_attachment' ? 'loading the attached data' : undefined),
 * ); // 'loading the attached data and 1 other call'
 * ```
 */
export function namedCalls(
  calls: readonly { readonly toolName: string }[],
  alsoUnnamed: number,
  displayNameOf: (toolName: string) => string | undefined,
): string | undefined {
  const named: string[] = [];
  let rest = alsoUnnamed;
  for (const call of calls) {
    const words = displayNameOf(call.toolName);
    if (words === undefined) rest += 1;
    else if (named.includes(words)) continue;
    else if (named.length < MAX_NAMED_CALLS) named.push(words);
    else rest += 1;
  }
  if (named.length === 0) return undefined;
  const parts = rest > 0 ? [...named, `${rest} other ${rest === 1 ? 'call' : 'calls'}`] : named;
  return parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
