/**
 * A set a model-facing sentence is allowed to NAME, after the role filter has
 * run over it (9.86.0) — and the one fact a filtered list cannot be written
 * without.
 *
 * ── OMIT, NEVER DENY ────────────────────────────────────────────────────
 *
 * A narrowing may take a name off a sentence. It may not turn that name's
 * absence into a claim that the thing is gone: the graph, the dispatch map and
 * the menu are all still holding it, and a model told "no skill was reachable"
 * stops asking for the one it may not be told about. Omission costs nothing and
 * is always true; the negative sentence is a denial of what the run holds.
 *
 * Every composer took plain arrays and branched on `length > 0`, so "the set
 * was empty" and "the filter emptied it" produced the SAME sentence — one
 * shape, two facts, in three separate places. `held` is that missing fact, and
 * it is REQUIRED rather than optional on purpose: the compiler now asks every
 * caller the question the call sites each forgot to answer.
 *
 * ── WHY THIS IS A LEAF AND NOT A HELPER IN THE GATE ─────────────────────
 *
 * It lived in `core/agent/stages/toolCalls.ts`, which put it on the wrong side
 * of the skill-graph fence: `read_skill`'s DESCRIPTION is composed inside
 * `src/lib/injection-engine/`, which may not import the agent loop, so the one
 * surface the model reads to CHOOSE a skill could not use the fact its own
 * refusals were being repaired with — and it went on printing "Nothing is
 * reachable from here" over a graph whose only hop the role filter had removed.
 * The same reason `src/lib/saidByPerson.ts` is a leaf: the writer and the
 * recogniser share one rule, so they cannot drift.
 *
 * @example
 * ```ts
 * const hidden = new Set(['beta']);
 * const hops = spoken(['beta'], (id) => !hidden.has(id));
 * // → { named: [], held: true } — the clause is DROPPED, not negated.
 * ```
 */
export interface SpokenIds {
  /** The members this sentence may name — what survived the filter. */
  readonly named: readonly string[];
  /** Did the UNFILTERED set hold anything? `true` with an empty `named` is the
   *  filtered-to-empty case: the clause is omitted rather than negated. */
  readonly held: boolean;
}

// FOLD · the one owner of whether a filtered set is empty because the filter emptied it (held) or because the run held nothing
// consumers read this and never re-derive it, each NAMED so the pointer survives an edit above it:
//   skillToolDescriptors.ts · describeOffer · the propose-transition refusal (toolCalls.ts · "── THE REFUSAL SPEAKS WITH THE FILTERED SETS")
//   toolCalls.ts · dispatchRoster · the read_skill gate's two sets (toolCalls.ts · "── Skill-graph read_skill GATE") · the turn-route offer
// detached: yes — { named, held } is freshly built; held is required, not optional, on purpose.
/**
 * Apply the role filter to one set and keep both halves (9.86.0).
 *
 * `mayName` is the caller's visibility predicate — skill ids test membership of
 * `scope.hiddenSkillIds`, tool names test whether every skill declaring them is
 * hidden. Both questions have one answer shape, and this is it.
 */
export function spoken(all: readonly string[], mayName: (id: string) => boolean): SpokenIds {
  return { named: all.filter(mayName), held: all.length > 0 };
}
