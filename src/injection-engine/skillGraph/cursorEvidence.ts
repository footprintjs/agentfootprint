import type { EntryDecl } from './graphRoutes.js';
import type { InjectionContext } from '../types.js';
import type { RouteWitness } from '../skillMatch.js';

/**
 * The cursor resolver (the keystone). Pure + deterministic. Given the iteration
 * context, returns the skill the graph should be *in* after this iteration AND the
 * clause that decided it (`CursorMove`; `nextSkill` is the `.to` projection):
 *   • cold start (`currentSkillId` unset) → first `entry` whose `when` passes
 *     (an `always`-entry — no `when` — matches unconditionally), else the entry
 *     the MODEL picked with `read_skill` (see "the model's pick" below);
 *   • a `from`-gated route (`fromId === currentSkillId`) whose predicate matches
 *     a result of the iteration's tool batch — results in call order, edges per
 *     result in declaration order; the first result with a match wins, later
 *     results matching OTHER targets are reported as `conflict` (9.16.0) →
 *     its target (the transition);
 *   • else the model's pick, when the read_skill gate accepted one this turn;
 *   • otherwise the current cursor unchanged (sticky stay).
 *
 * **The model's pick (`ctx.pendingSkillPick`) — the D2 "validated volunteer".**
 * `read_skill(id)` is already GATED to `reachableSkills(cursor)` (the model may
 * only name a skill the graph declares as reachable from where it stands), and
 * the tool answers "Skill 'id' activated for the next iteration." Until 8.3.0 the
 * cursor ignored that answer for every form except `.entryByRead()`'s cold start,
 * so the sentence was false wherever the skill's activation was cursor-gated or
 * rule-gated. It is honoured here, at ONE place, with the precedence the design
 * pinned (docs/design/skill-graph.md §4A.1): a declared edge that fired this hop
 * WINS over a same-turn pick (`D1 > D2`) — the author's determinism is never
 * overridden by a model guess. The pick is one-shot (the tool-calls stage rewrites
 * it every iteration), so a pick can never drag the cursor backwards after a later
 * edge has moved it.
 *
 * Each candidate predicate runs in its OWN try/catch so one throwing edge can't
 * block its siblings or crash the loop — a throw is treated as "no match" and,
 * in dev mode, warned. This is the design's `routeForResult` pin-table target.
 *
 * The `by` on each return is decided at the same statement as the destination
 * (8.5.0). That matters most in the case an outside observer cannot reconstruct:
 * a declared edge and a same-turn model pick naming the SAME target. `D1 > D2`
 * makes it a `'route'`, and only this function knows.
 */
/** The winning entry's recorded evidence, as a spreadable fragment: `{ witness }`
 *  when the rule was DATA and it yielded quotable text, `{}` otherwise (a `when`
 *  predicate, an unconditional entry, a match with nothing quotable). A throwing
 *  extractor is treated exactly as no evidence — a record is never worth a crash,
 *  and the hop itself already happened. */
export function witnessOf(entry: EntryDecl, ctx: InjectionContext): { witness?: RouteWitness } {
  if (!entry.witness) return {};
  try {
    const found = entry.witness(ctx);
    return found === undefined ? {} : { witness: found };
  } catch {
    return {};
  }
}
