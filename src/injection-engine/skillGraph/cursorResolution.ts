import type { EntryDecl, RouteDecl } from './graphRoutes.js';
import type { InjectionContext } from '../types.js';
import type { CursorMove, RouteBatchOutcome, GuardEvaluation } from './graphCursor.js';
import { isHiddenSkill, toolResultsOf } from '../types.js';
import { witnessOf } from './cursorEvidence.js';
import { warnMatcherThrew } from './passMemo.js';
import { isDeterministicRoute, edgePreconditionsPass, routeMatches } from './routePredicates.js';

// FOLD · the one owner of where the cursor goes next, and which clause decided it (CursorMove)
// consumers read this and never re-derive it: the `nextSkill` and `explainNextSkill` hooks the Evaluate stage asks;
// the memoized `nextSkillForTriggers` that `deriveTrigger` reads; and `makeSupersededEntries`.
// NOT skillToolDescriptors: the read_skill description reads the ALREADY-RESOLVED cursor off the offer (offer.cursorId).
// detached: yes — a POJO plus a string id, memoized per pass so two readers get one decided value.
export function makeResolveCursor(
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
  llmReadEntry = false,
): (ctx: InjectionContext) => CursorMove {
  const isEntry = (id: string): boolean => entries.some((e) => e.id === id);
  return (ctx) => {
    // ROLE VISIBILITY. The cursor never moves onto a skill this caller's role
    // may not read (`isHiddenSkill`, the same rule the evaluator refuses
    // activation by), so the stored cursor and the active set cannot
    // disagree. Every clause below asks `may` before it names a destination:
    // a keyword in the message, a declared edge, a tool proposal and a pick
    // are all untrusted routes to the same place. A cursor already standing
    // on a hidden skill (a restored conversation, a grant revoked mid-run) is
    // treated as no cursor, so the turn re-enters through the visible entries.
    const may = (id: string): boolean => !isHiddenSkill(ctx, id);
    const cur =
      ctx.currentSkillId !== undefined && may(ctx.currentSkillId) ? ctx.currentSkillId : undefined;
    const from = cur !== undefined ? { from: cur } : {};
    // The turn-start cascade's verdict (SG-C) — a PRECOMPUTED input consumed
    // exactly as `pendingSkillPick` is, on iteration 1 only (the RouteTurn
    // stage decided it off the hot loop; `userMessage` is fixed for the run,
    // so iterations 2..N keep today's law byte-for-byte). Present only on
    // cascade graphs (`classify` / `continuity: 'conversation'`); absent, not
    // one line here behaves differently. A `menu`/`none` verdict carries no
    // `to` and falls through — the model resolves the menu via the ordinary
    // gated pick (D2), which is what keeps the offer and the verdict one
    // machinery; the cold-start walk below is suppressed by the verdict's
    // PRESENCE, so falling through can never enter an entry the record does
    // not claim.
    if (ctx.iteration === 1 && ctx.turnRoute?.to !== undefined && may(ctx.turnRoute.to)) {
      const by =
        ctx.turnRoute.by === 'intent'
          ? ('intent' as const)
          : ctx.turnRoute.by === 'continuity'
          ? ('continuity' as const)
          : ctx.turnRoute.by === 'decider'
          ? ('decider' as const)
          : ('entry' as const);
      return {
        ...(ctx.turnRoute.from !== undefined && { from: ctx.turnRoute.from }),
        to: ctx.turnRoute.to,
        by,
        // The cascade already extracted the tier-1 evidence (`turn_routed`
        // carries it); the hop repeats it rather than re-deriving it, so the
        // two records can never quote different text.
        ...(ctx.turnRoute.witness !== undefined && { witness: ctx.turnRoute.witness }),
      };
    }
    if (cur === undefined) {
      // Cold start: declaration-order first entry whose intent predicate passes.
      // `.entryByRead()` skips this — there the library deliberately does NOT
      // auto-pick; the model reads the menu and picks (below), so no entry body
      // loads until it does. A turn whose cascade left a VERDICT on scope
      // (`ctx.turnRoute`, SG-C) skips it the same way: suppression follows the
      // verdict, not only the compile-time flag, because an entry-scorer graph
      // opts into the cascade at MOUNT time (`continuity: 'conversation'`) —
      // it compiles with `llmReadEntry` false, yet its cold `menu`/`none`
      // verdict (a near-tie, or the scorer-throw fallback) must reach the
      // model, never be overridden by the declaration-order walk while the
      // record claims a menu is outstanding. RouteTurn writes the POJO only
      // when the cascade DECIDED something, so a graph whose cold start still
      // belongs to this walk (no rules, no tier 2 — e.g. after a dropped
      // resume) keeps it.
      if (!llmReadEntry && ctx.turnRoute === undefined) {
        for (const e of entries) {
          if (!may(e.id)) continue;
          if (!e.when) return { to: e.id, by: 'entry' };
          try {
            // The witness is extracted HERE, on the winner only — the losing
            // rules never pay for evidence, and an unconditional/`when` entry
            // has none to give (`witnessOf` answers undefined).
            if (e.when(ctx)) return { to: e.id, by: 'entry', ...witnessOf(e, ctx) };
          } catch (err) {
            warnMatcherThrew(`entry "${e.id}"`, err);
          }
        }
      }
      // A cold ACCEPTED tool proposal enters exactly where a cold model pick
      // may (an entry — the reachable-from-cold set), and OUTRANKS the pick:
      // deterministic tool evidence over a model guess, the same order the
      // mid-run walk applies below (9.19.0).
      const coldProposal = ctx.pendingToolTransition?.targetSkillId;
      if (coldProposal !== undefined && isEntry(coldProposal) && may(coldProposal)) {
        return { to: coldProposal, by: 'tool-proposal' };
      }
      // The model's pick becomes the starting cursor. This is what `.entryByRead()`
      // has always done; 8.3.0 makes it true for EVERY start form, which is what
      // makes the rules form's documented fallback ("no rule matched → the model
      // picks from the read_skill menu") actually work. An entry's `when` is the
      // AUTOMATIC pick's condition, not a lock on the manual one: the model asked
      // for this skill by name and the gate allowed it.
      if (
        ctx.pendingSkillPick !== undefined &&
        isEntry(ctx.pendingSkillPick) &&
        may(ctx.pendingSkillPick)
      ) {
        return { to: ctx.pendingSkillPick, by: 'model-pick' };
      }
      for (const e of entries) {
        if (may(e.id) && ctx.activatedInjectionIds.includes(e.id)) {
          return { to: e.id, by: 'model-pick' };
        }
      }
      return { by: 'none' };
    }
    // D1 — transition: the whole tool batch, in CALL order (9.16.0). Per
    // result, the first from-gated deterministic edge in DECLARATION order
    // that fires names that result's target; the first RESULT with a target
    // wins the cursor. Two orders, two jobs: declaration order is the
    // author's tiebreak when one result could match several edges (the D1
    // law, unchanged), call order is the run's tiebreak across results —
    // the tool that returned first routed first. Before 9.16.0 only the
    // LAST call of a batch was consulted, so identical batches routed
    // differently depending on call order (the 9.15.0 L1 probe). A later
    // result matching a DIFFERENT target is suppressed AND reported on the
    // move (`conflict`), never silently dropped; a batch of one is
    // byte-identical to the old singular walk. D1 still wins over a
    // same-turn model pick — INCLUDING when both name the same target,
    // which is why the cause is decided here and not inferred downstream
    // from the destination.
    let winner: RouteBatchOutcome | undefined;
    let losers: RouteBatchOutcome[] | undefined;
    // Guard evidence (9.51.0), collected at the very statements that decide:
    // the winning edge's evaluation (verdict true) and — per guarded edge —
    // the FIRST refusal whose preconditions a result met (verdict false).
    // A guarded edge whose tool/status preconditions never matched leaves no
    // record: its guard never decided anything.
    let winnerGuard: GuardEvaluation | undefined;
    let guardsClosed: GuardEvaluation[] | undefined;
    let closedEdges: Set<RouteDecl> | undefined;
    for (const res of toolResultsOf(ctx)) {
      let target: string | undefined;
      let targetGuard: GuardEvaluation | undefined;
      for (const r of routes) {
        if (r.fromId !== cur) continue;
        if (!isDeterministicRoute(r)) continue; // model edges don't auto-fire
        if (!may(r.toId)) continue; // an edge into a hidden skill never fires
        try {
          if (r.guard !== undefined) {
            // The guard is judged AFTER the edge's own tool/status
            // preconditions, over the hop view (the six hop keys + the
            // result's JSON fields — see skillGuard.ts). `evaluate` and the
            // routing predicate are one compilation, so the recorded
            // conditions ARE the ones that routed.
            if (!edgePreconditionsPass(r, res)) continue;
            const evaluation = r.guard.evaluate({
              toolName: res.toolName,
              result: res.result,
              ...(res.status !== undefined && { status: res.status }),
              iteration: ctx.iteration,
              userMessage: ctx.userMessage,
              currentSkillId: cur,
            });
            const record: GuardEvaluation = {
              from: r.fromId,
              to: r.toId,
              toolName: res.toolName,
              ...(res.toolCallId !== undefined && { toolCallId: res.toolCallId }),
              verdict: evaluation.verdict,
              conditions: evaluation.conditions,
            };
            if (evaluation.verdict) {
              target = r.toId;
              targetGuard = record;
              break;
            }
            if (!(closedEdges ??= new Set()).has(r)) {
              closedEdges.add(r);
              (guardsClosed ??= []).push(record);
            }
            continue;
          }
          if (routeMatches(r, res)) {
            target = r.toId;
            break;
          }
        } catch (err) {
          warnMatcherThrew(`route ${r.fromId}→${r.toId}`, err);
        }
      }
      if (target === undefined) continue;
      const outcome: RouteBatchOutcome = {
        ...(res.toolCallId !== undefined && { toolCallId: res.toolCallId }),
        toolName: res.toolName,
        target,
      };
      if (winner === undefined) {
        winner = outcome;
        winnerGuard = targetGuard;
      } else if (target !== winner.target) (losers ??= []).push(outcome);
    }
    // The refusals ride WHATEVER move resulted — a closed guard explains a
    // stay (or the hop that won instead) the same way `supersededEntries`
    // explains a suppressed entry.
    const closed = guardsClosed !== undefined ? { guardsClosed } : {};
    if (winner !== undefined) {
      return {
        ...from,
        to: winner.target,
        by: 'route',
        ...(winnerGuard !== undefined && { guard: winnerGuard }),
        ...closed,
        ...(losers !== undefined && { conflict: { winner, losers } }),
      };
    }
    // D1.5 — the ACCEPTED tool proposal (9.19.0): no declared edge fired, so
    // a `propose-transition` effect the gate validated moves the cursor. It
    // sits BETWEEN the edges and the pick on purpose: a declared edge is the
    // author's determinism (never overridden), a proposal is the tool
    // author's determinism (code that shipped), a pick is the model's guess.
    // A proposal of the CURRENT skill is a no-op stay, not a hop.
    const proposal = ctx.pendingToolTransition?.targetSkillId;
    if (proposal !== undefined && proposal !== cur && may(proposal)) {
      return { ...from, to: proposal, by: 'tool-proposal', ...closed };
    }
    // D2 — the validated volunteer: no declared edge fired, so the model's own
    // (already gated) pick moves the cursor. A pick of the CURRENT skill is a
    // no-op stay, not a hop.
    if (
      ctx.pendingSkillPick !== undefined &&
      ctx.pendingSkillPick !== cur &&
      may(ctx.pendingSkillPick)
    ) {
      return { ...from, to: ctx.pendingSkillPick, by: 'model-pick', ...closed };
    }
    return { ...from, to: cur, by: 'stay', ...closed }; // sticky stay — no edge out of cur fired
  };
}
