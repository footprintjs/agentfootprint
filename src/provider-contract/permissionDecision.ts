/**
 * The two questions asked about a permission checker: will it be ASKED about a
 * capability (`checkerGoverns`), and what did its ANSWER mean
 * (`readPermissionDecision`, THE ONE READER of a checker's answer).
 *
 * Why it exists: a checker is a port, and what comes back through it is not
 * always what its type says. A remote policy service's JSON cast to
 * `PermissionDecision`, a hand-written checker that returns `{}`, a typo such
 * as `'deny '` or `'ALLOW'`, a value from a newer vocabulary such as `'ask'` —
 * none of these said yes. Before this reader, the tool gate refused only on an
 * exact `'deny'` or `'halt'`, so every one of them RAN the tool, while the
 * skill menu, asking the same checker, hid the skill for the same answer. Two
 * readings of one answer is two policies.
 *
 * The rule: only a known allow (`'allow'`, `'gate_open'`) allows. `'deny'` and
 * `'halt'` keep their own meanings. Anything else is a refusal that says the
 * answer was not recognised, so the record never shows an answer the library
 * did not act on.
 *
 * @example
 *   readPermissionDecision({ result: 'allow' });  // { kind: 'allow', result: 'allow' }
 *   readPermissionDecision({ result: 'deny ' });  // { kind: 'unrecognised', rationale: "… got 'deny '" }
 *   readPermissionDecision({});                    // { kind: 'unrecognised', rationale: '… got no result' }
 */

import type { PermissionCapability, PermissionChecker } from './types.js';

/**
 * Does this checker ask to be consulted about `capability`? (9.11.0)
 *
 * `'tool_call'` is always true — it has been enforced since v2.4 and needs no
 * declaration. Everything else is true only when the checker named it.
 * Absence is NO.
 */
export function checkerGoverns(
  checker: PermissionChecker | undefined,
  capability: PermissionCapability,
): boolean {
  if (!checker) return false;
  if (capability === 'tool_call') return true;
  return checker.governs?.includes(capability) === true;
}

/** What the library does with one checker answer. */
export type PermissionReading =
  /** Proceed. `result` is the recognised answer, recorded as given. */
  | { readonly kind: 'allow'; readonly result: 'allow' | 'gate_open' }
  /** Refuse; the model may choose differently. */
  | { readonly kind: 'deny' }
  /** Refuse and end the run. */
  | { readonly kind: 'halt' }
  /** Refuse, fail-closed: the answer is not one the library knows. */
  | { readonly kind: 'unrecognised'; readonly rationale: string };

/** Longest quoted answer kept in the rationale — a checker's value is not a log line. */
const QUOTED_MAX = 40;

/**
 * Read `decision.result` ONCE (a getter must not answer twice) and say what it
 * means. Never throws for an odd value; a throwing getter still throws, which
 * every caller already treats as a checker that did not answer.
 */
export function readPermissionDecision(decision: unknown): PermissionReading {
  const result =
    typeof decision === 'object' && decision !== null
      ? (decision as { result?: unknown }).result
      : undefined;
  if (result === 'allow' || result === 'gate_open') return { kind: 'allow', result };
  if (result === 'deny') return { kind: 'deny' };
  if (result === 'halt') return { kind: 'halt' };
  return {
    kind: 'unrecognised',
    rationale:
      `permission checker answer not recognised: expected 'allow', 'gate_open', 'deny' or ` +
      `'halt', got ${describeAnswer(decision, result)}`,
  };
}

function describeAnswer(decision: unknown, result: unknown): string {
  if (typeof decision !== 'object' || decision === null) return 'no decision';
  if (result === undefined) return 'no result';
  if (typeof result !== 'string') return result === null ? 'null' : `a ${typeof result}`;
  const quoted = result.length > QUOTED_MAX ? `${result.slice(0, QUOTED_MAX)}…` : result;
  return `'${quoted}'`;
}
