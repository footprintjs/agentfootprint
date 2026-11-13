/**
 * What did a permission checker's ANSWER mean? `readPermissionDecision` is THE
 * ONE READER of a checker's answer. (Whether the checker is asked at all is
 * `types.ts` · `checkerGoverns`; it stays there because `types.ts` is an
 * allow-listed leaf of the skill-graph fence, which must gain no import.)
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
  if (typeof result !== 'string') return kindOf(result);
  const quoted = result.length > QUOTED_MAX ? `${result.slice(0, QUOTED_MAX)}…` : result;
  return `'${quoted}'`;
}

/** A non-string answer by its kind, with its article: "an object", "an array", "a number". */
function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return `a ${typeof value}`;
  try {
    return Array.isArray(value) ? 'an array' : 'an object';
  } catch {
    return 'an object'; // a revoked Proxy throws on `Array.isArray`; it is still an object
  }
}
