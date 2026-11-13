/**
 * toolOutcome — the normalized tool-outcome vocabulary, as a PURE leaf
 * (9.34.0).
 *
 * WHY IT LIVES HERE. A skill-graph route edge can key on what a tool
 * DECLARED happened (`onToolStatus`), so this vocabulary is part of the
 * graph's own reading of a turn — `InjectionContext.toolResults[].status`
 * is typed by it. It used to be declared inside `core/agent/toolEffects.ts`
 * (today `semantics/toolEffects.ts`),
 * which meant the graph's context type reached into the agent loop's
 * tool-effects module for one string union: the loop's vocabulary embedded
 * in the graph's contract, pointing the dependency the wrong way.
 *
 * So the words moved DOWN here — a module with zero imports that both
 * sides read. `semantics/toolEffects.ts` re-exports them under the same
 * names, so every existing import path is unchanged; that module remains
 * the owner of the ENVELOPE grammar (the two effect kinds, the recognizer).
 *
 * Zone: a zero-import leaf the skill-graph PURE CORE may reach (`PURE_LEAVES`).
 * Pinned by `test/injection-engine/skill-graph-fence.test.ts`.
 */

/**
 * Normalized outcome of one tool call, declared by the tool itself. Seven
 * values, deliberately closed: routing keyed on meaning needs a vocabulary
 * both sides spell identically. A word a tool wrote is read by this
 * module's `readToolResultStatus`: another case or surrounding spaces still
 * name the same word, and a string that names none of the seven makes the
 * value NOT an envelope (data path, unchanged).
 *
 * `'absent'` is the seventh (the `absent()` primitive, from field use), and
 * it earns its own word rather than folding into `'success'` or `'failure'`
 * for the reason the primitive exists: *nothing found* and *could not look*
 * must not route down the same edge. Under `'failure'` an honest empty answer
 * sends an operator to investigate a healthy collector; under `'success'` a
 * route that wants to escalate on "we found nothing" has nothing to key on.
 * A tool may declare it directly (`{ content, effects: [], status:
 * 'absent' }`); returning `absent(…)` makes the framework declare it.
 */
export type ToolResultStatus =
  | 'success'
  | 'failure'
  | 'denied'
  | 'invalid'
  | 'partial'
  | 'pending'
  | 'absent';

/** The closed set, as data — validators and docs read one list. */
export const TOOL_RESULT_STATUSES: readonly ToolResultStatus[] = [
  'success',
  'failure',
  'denied',
  'invalid',
  'partial',
  'pending',
  'absent',
];

/**
 * THE ONE READING of a status word a tool wrote: one of the seven, or
 * `undefined`. A second spelling of a known word — another case, or spaces
 * around it — is that word: `'FAILURE'`, `' Denied '` and `'failure'` all
 * read as `'failure'`. Anything else (not a string, or no known word once
 * trimmed and lower-cased) is `undefined`.
 *
 * Why: the envelope recognizer used to compare the word exactly, so a tool
 * that wrote `status: 'FAILURE'` had its whole result treated as data, and a
 * procedure step it ran advanced as if its tool had reported nothing. A
 * tool written in another language or by hand, or a status read from an
 * upstream API, spells the same meaning in more than one case; reading the
 * word once, here, means the envelope, a step and a route edge cannot
 * disagree about which word a tool meant. Read by
 * `semantics/toolEffects.ts` (the recognizer and its near-miss diagnosis).
 *
 * @example readToolResultStatus(' Failure ') // 'failure'
 * @example readToolResultStatus('oops')      // undefined
 */
export function readToolResultStatus(value: unknown): ToolResultStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const word = value.trim().toLowerCase();
  return (TOOL_RESULT_STATUSES as readonly string[]).includes(word)
    ? (word as ToolResultStatus)
    : undefined;
}
