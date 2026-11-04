import type { Injection, InjectionContext, InjectionTrigger } from '../types.js';
import type { EntryDecl, RouteDecl } from './graphRoutes.js';
import { isDeterministicRoute } from './routePredicates.js';

/** Compile a skill's incoming edges → one injection trigger (or null = keep the
 *  skill's default `llm-activated` trigger, i.e. model-reachable via read_skill).
 *
 *  A route target B is active iff `nextSkill(ctx) === B`. That single expression
 *  delivers all three keystone properties from ONE source of truth:
 *    • `from`-gating  — `nextSkill` only fires an edge `A→B` while the cursor is
 *      on A, so the edge no longer bleeds into an unrelated skill D (the v1 bug);
 *    • stickiness     — when the cursor is on B and no edge leaves B, `nextSkill`
 *      returns B (sticky stay), so B re-activates each iteration;
 *    • clean handoff  — the iteration a `B→C` edge fires, `nextSkill` returns C,
 *      so B deactivates the SAME step C activates — no double-active overlap.
 *  Because the loop's cursor-update stage is ALSO `currentSkillId = nextSkill(ctx)`,
 *  the trigger and the cursor can never disagree. */
export function deriveTrigger(
  id: string,
  _skill: Injection,
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
  nextSkill: (ctx: InjectionContext) => string | undefined,
  exclusiveEntries: boolean,
): InjectionTrigger | null {
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    // `.entryByRelevance()` / `.entryByRead()` make the entries EXCLUSIVE candidates:
    // exactly ONE loads — the best match (embedder) or the model's pick (read_skill) —
    // as the cursor, so only that entry's body lands (token-efficient). The same
    // cursor-gated trigger as a route target delivers that for both modes.
    if (exclusiveEntries) {
      return { kind: 'rule', activeWhen: (ctx) => nextSkill(ctx) === id };
    }
    // Default (v1): a persistent base (always) or intent-conditional (rule).
    // An unconditional entry is `always` — the cursor can add nothing to it. This is
    // the ONE declared way to be co-active beside whatever the cursor is on, and it
    // is untouched by 8.15.0.
    if (!entry.when) return { kind: 'always' };
    // An intent-conditional entry is active EXACTLY WHILE THE CURSOR IS ON IT (8.15.0)
    // — the same expression the exclusive-entry arm above and the route-target arm
    // below already use. One law for a flat graph: a skill is active iff the cursor is
    // on it, or it declared itself unconditional.
    //
    // 8.3.0 added the cursor clause to a rule-only trigger and left the rule clause
    // standing as an OR. That leftover was the bug: an entry S with a `when` that
    // routes to T stayed active on the hop (its rule reads the user's message, which
    // does not change mid-turn), so S and T were both on the wire — two skill bodies,
    // two tool sets — for a graph drawn as a single-file state machine. And it was the
    // steady state, not a blip: every later iteration parked the cursor on T while S's
    // rule still matched, so S came back. This finishes 8.3.0 rather than reverting
    // it — both failures 8.3.0 names (a declared `step` INTO an entry skill; a
    // `read_skill` pick onto one) are carried by the CURSOR clause, which survives.
    //
    // The rule is still evaluated FIRST, and deliberately: a throwing entry predicate
    // must keep surfacing as the evaluator's `skipped: 'predicate-threw'`, which it
    // only can if the trigger calls it. Its answer is then used for exactly one thing
    // — the cold-start fallback below, when the graph has no cursor at all.
    //
    // A rule that matched while the cursor is elsewhere is a SUPPRESSION, and the run
    // says so: `supersededEntries(ctx)` reports it and the Injection Engine stamps it
    // on `agentfootprint.context.evaluated` as `supersededIds`.
    const activeWhen = entry.when;
    return {
      kind: 'rule',
      activeWhen: (ctx) => {
        const matched = activeWhen(ctx);
        const to = nextSkill(ctx);
        if (to === id) return true; // the cursor lands here — my turn
        if (to !== undefined) return false; // the graph is engaged elsewhere — not my turn
        return matched; // no cursor at all → the rule alone
      },
    };
  }

  // Deterministic incoming edges (when / onToolReturn / onToolStatus) →
  // cursor-gated + sticky.
  const incoming = routes.filter(isDeterministicRoute).filter((r) => r.toId === id);
  if (incoming.length === 0) return null; // model-reachable — keep default trigger

  return { kind: 'rule', activeWhen: (ctx) => nextSkill(ctx) === id };
}
