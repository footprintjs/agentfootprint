/**
 * moments — PUBLIC. The five places in the loop where a rule may speak.
 *
 * Pattern: Closed enumeration + a mechanical name mapping, with the mapping
 *          pinned by the compiler rather than by memory.
 * Role:    core/ layer. `LoopMoment` is the vocabulary `.act()` is keyed on
 *          and the vocabulary every ledger row now stamps itself with, so a
 *          person asking "where in the loop did this happen?" and a person
 *          asking "where in the loop can I intervene?" are reading the same
 *          five words.
 * Emits:   N/A (types + one pure function).
 *
 * ## Why the list is here and not inside `.act()`
 *
 * A bundle whose keys ARE the moments is only honest while the two sets
 * agree. Keep the list of moments in the options type and the sixth moment
 * ships with no key and nothing notices; keep it here, derive the key names
 * from it, and the day a moment is added the build fails inside `act.ts`
 * naming the key nobody wrote. That is the same trick `conformSource` plays
 * on the outside world, turned inward on ourselves.
 *
 * The mapping between the two spellings is mechanical — kebab in the record
 * (`'before-tool'`, which reads as a phase), camel in the bundle
 * (`beforeTool`, which reads as a property) — and `actKeyFor` is its runtime
 * twin, so the validator that decides which keys `.act()` accepts is
 * DERIVED from this list rather than typed out beside it.
 */

/**
 * Every moment of one agent turn where a rule may act, in the order the loop
 * reaches them.
 *
 * ```
 * input → [ window → … LLM … → before-tool → tool → after-tool ]* → output
 * ```
 *
 * `watch` attends all five and more; `act` attends exactly these. The
 * difference is what a rule may DO there — an observer reports, a rule
 * changes what happens next.
 */
export const LOOP_MOMENTS = ['input', 'before-tool', 'after-tool', 'window', 'output'] as const;

/** One of the five moments. See {@link LOOP_MOMENTS}. */
export type LoopMoment = (typeof LOOP_MOMENTS)[number];

/**
 * The `.act()` key that governs a moment: the moment's name, camel-cased.
 *
 * `'before-tool'` → `beforeTool`. Purely mechanical, so there is no list of
 * pairs anywhere for the two spellings to drift apart in.
 */
export type ActKey<M extends LoopMoment = LoopMoment> = M extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<Tail>}`
  : M;

/**
 * The runtime twin of {@link ActKey}. `.act()`'s accepted key set is built
 * from this over `LOOP_MOMENTS`, so an unknown key is refused by a rule that
 * cannot fall behind the list it is derived from.
 */
export function actKeyFor(moment: LoopMoment): ActKey {
  return moment.replace(/-(.)/g, (_match, c: string) => c.toUpperCase()) as ActKey;
}
