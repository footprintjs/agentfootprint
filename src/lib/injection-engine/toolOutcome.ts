/**
 * toolOutcome — the normalized tool-outcome vocabulary, as a PURE leaf
 * (9.34.0).
 *
 * WHY IT LIVES HERE. A skill-graph route edge can key on what a tool
 * DECLARED happened (`onToolStatus`), so this vocabulary is part of the
 * graph's own reading of a turn — `InjectionContext.toolResults[].status`
 * is typed by it. It used to be declared inside `core/agent/toolEffects.ts`,
 * which meant the graph's context type reached into the agent loop's
 * tool-effects module for one string union: the loop's vocabulary embedded
 * in the graph's contract, pointing the dependency the wrong way.
 *
 * So the words moved DOWN here — a module with zero imports that both
 * sides read. `core/agent/toolEffects.ts` re-exports them under the same
 * names, so every existing import path is unchanged; that module remains
 * the owner of the ENVELOPE grammar (the two effect kinds, the recognizer,
 * the lease shapes), which is genuinely loop-side.
 *
 * Zone: PURE CORE. Pinned by
 * `test/lib/injection-engine/skill-graph-fence.test.ts`.
 */

/**
 * Normalized outcome of one tool call, declared by the tool itself. Seven
 * values, deliberately closed: routing keyed on meaning needs a vocabulary
 * both sides spell identically. A string outside this set makes the value
 * NOT an envelope (data path, unchanged).
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
