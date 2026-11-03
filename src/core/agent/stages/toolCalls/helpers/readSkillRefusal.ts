import type { SkillTargetClass } from '../../../../../injection-engine/skillGraph.js';
import type { SpokenIds } from '../../../../../lib/spokenIds.js';
import type { TurnRoute } from '../../../../../injection-engine/routingPolicy.js';

// LENS · tool-result · persistent-history
// reads: hops/open ← deps.allowedSkillIds + deps.openSkillIds, each through scope.hiddenSkillIds via spoken()
//        target class ← skillGraph.ts · classifySkillTarget, carried in, not re-derived
//        menu/turnStartedBy ← scope.turnRoute (the routing verdict, whole, not a boolean)
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * THE ONE COMPOSER of every `read_skill` refusal (9.86.0) — reachability,
 * posture and tree, from one set of inputs.
 *
 * ── WHY ONE ─────────────────────────────────────────────────────────────
 *
 * There were two, and they disagreed. `skillRefusal` named "Reachable skills:
 * beta" from the graph's raw hop set; `postureRefusal`, forty lines below it in
 * the same gate, answered a model that took that offer up with "read_skill here
 * reaches only the open skills: gamma". Same call, same turn, opposite claims —
 * and the second one cost a refusal from the escalation budget to discover.
 * Neither had heard of the role filter, so both could name a skill the caller's
 * policy hides. One composer, handed the FILTERED sets and the posture that
 * will judge the next pick, cannot contradict itself that way.
 *
 * ── THE TENSE DISCIPLINE (the law `selfCallNotice` is written against) ──
 *
 * A tool result is composed on iteration N and re-read by the model on every
 * later call of the turn, including the tool-less wrap-up. So every clause here
 * is a PAST fact about ONE named call — the call the model made `read_skill`
 * on — anchored by the phrase "that call", never by deixis ("this turn", "the
 * call you just made") and never by a forecast ("you can call", "pick one of
 * these"). What the model may do NEXT is owned by the `read_skill` DESCRIPTION,
 * which is recomposed for every single request and may therefore speak in the
 * present. Two owners, one tense each, and they can no longer disagree.
 *
 * ── AND WHY IT NEVER NAMES A HOP THE POSTURE WOULD DECLINE ──────────────
 *
 * Under `'rails'` the model does not route at all; under `'guard'` it routes
 * only from an outstanding menu. Naming hops there is an offer the very next
 * arm of this gate refuses. So those arms name no hop: they say who DID route,
 * and (when there are any) which open skills were admitted anyway — open skills
 * never reach the posture arm, so that clause cannot be contradicted.
 *
 * ── AND WHY AN EMPTY LIST IS NEVER A DENIAL ─────────────────────────────
 *
 * Every set arrives as {@link SpokenIds}, which carries whether the UNFILTERED
 * set held anything. That is the difference between "nothing was reachable" and
 * "nothing reachable may be named", and this composer used to say the first
 * when the second was true — over a graph that was routing the cursor the whole
 * time. Where the filter empties a set, the clause is omitted. A model told the
 * map is a dead end stops asking for the door it may not be shown.
 *
 * Exported so a producer registry can list it beside the other model-facing
 * composers rather than re-deriving what it says.
 */
export function composeReadSkillRefusal(args: {
  /** The id the model asked for, verbatim. */
  readonly requestedId: string;
  /** Which class the target fell in — from `classifySkillTarget`, the one owner. */
  readonly targetClass: SkillTargetClass;
  /** Where the cursor stood when that call was made. */
  readonly cursorId?: string;
  /** Declared hops from that cursor, through the role filter — and carrying
   *  whether the graph held any, so a filtered-to-empty set omits its clause
   *  instead of denying the hops the graph is holding. */
  readonly hops: SpokenIds;
  /** Open skills, through the same filter. */
  readonly openIds: SpokenIds;
  /** The mounted graph is a decision `tree()` — no cursor to move. */
  readonly isTree?: boolean;
  /** The posture that declined a reachable hop, when one did (SG-C). */
  readonly posture?: 'guard' | 'rails';
  /** The menu that was outstanding when that call was made, through the same
   *  filter. Present only under `'guard'` with a menu the pick missed — and
   *  `held: true` with nothing named says a menu WAS outstanding and none of it
   *  may be named, which is a third sentence, not the no-menu one. */
  readonly menuOffered?: SpokenIds;
  /** How the turn's start was resolved — `TurnRoute.by` — for the
   *  `'guard'`-without-a-menu arm. Each value is a different past fact about
   *  the turn, and the arm says only the one it was handed (9.86.1): it used to
   *  append "Declared routes moved the cursor instead." to every no-menu
   *  refusal, which is false for a cursor carried over from the previous turn
   *  (`'continuity'`) and for a menu the model's own pick had resolved
   *  (`'menu'`), and unprovable for `'none'`. */
  readonly turnStartedBy?: TurnRoute['by'];
  /** A cursor EXISTED on that call and the role filter kept its id out of the
   *  sentence (9.86.1). `cursorId` is absent in two situations that need two
   *  different sentences: a cold start, where "the turn's start" is the true
   *  anchor, and a hidden cursor, where the skill is real and merely unnamed.
   *  The description already withholds a hidden cursor's name — pinned by
   *  `test/security/skill-visibility.test.ts` — and the refusal printed it raw. */
  readonly cursorWithheld?: boolean;
}): string {
  const {
    requestedId,
    targetClass,
    cursorId,
    hops,
    openIds,
    isTree,
    posture,
    menuOffered,
    turnStartedBy,
    cursorWithheld,
  } = args;
  const head = `read_skill("${requestedId}") was not granted on that call: `;
  // Open skills are the one list every arm may name: they are admitted from
  // every cursor and no posture governs them (the posture arm below is reached
  // only by hops), so naming them cannot be falsified by the next call. There is
  // no negative arm here and there never was — an unnamed open set is simply
  // omitted, which is the shape the two arms below now share.
  const openClause =
    openIds.named.length > 0
      ? ` Open skills were admitted on that call: ${openIds.named.join(', ')}.`
      : '';
  if (posture !== undefined) {
    if (posture === 'rails') {
      return (
        `${head}this graph's 'rails' posture reserves routing to the framework — turn ` +
        `starts resolve by declared rule or scorer and transitions by declared routes — ` +
        `so a model pick was not admitted on that call.${openClause}`
      );
    }
    if (menuOffered !== undefined && menuOffered.named.length > 0) {
      return (
        `${head}this graph's 'guard' posture admits a routing pick only from the menu the ` +
        `framework offered, and '${requestedId}' was not on it. The menu outstanding when ` +
        `that call was made: ${menuOffered.named.join(', ')}.${openClause}`
      );
    }
    // A menu WAS outstanding and not one of its ids may be named to this
    // caller. Neither of the other two sentences is available: naming the menu
    // would leak it, and "no menu was outstanding" is false — as is the
    // "declared routes moved the cursor instead" clause that rides with it,
    // which is a second assertion about a turn that did not route that way. So
    // this arm says the one thing that is true of that call and stops.
    if (menuOffered !== undefined && menuOffered.held) {
      return (
        `${head}this graph's 'guard' posture admits a routing pick only from the menu the ` +
        `framework offered, and '${requestedId}' was not admitted on that call.${openClause}`
      );
    }
    // What the gate KNOWS about why no menu was outstanding is `TurnRoute.by`,
    // and each value is a different finished fact. Nothing is asserted about
    // how the cursor came to be where it was beyond that — the old tail,
    // "Declared routes moved the cursor instead.", was composed for every
    // value and was true of none of them in particular.
    const startClause =
      turnStartedBy === 'entry' || turnStartedBy === 'intent'
        ? " — the turn's start had already been resolved decisively"
        : turnStartedBy === 'continuity'
        ? ' — the cursor had been carried over from the previous turn'
        : turnStartedBy === 'menu'
        ? ' — the menu had already been resolved by an earlier pick'
        : turnStartedBy === 'decider'
        ? " — the menu had been resolved by the configured decider before the turn's first call"
        : '';
    return (
      `${head}this graph's 'guard' posture admits a routing pick only while the framework ` +
      `has declared ambiguity, and no menu was outstanding when that call was made` +
      `${startClause}.${openClause}`
    );
  }
  if (isTree === true) {
    return (
      `${head}this map is a decision tree. A tree routes by predicate on every iteration ` +
      `and keeps no cursor, so there was nothing for that pick to move and ` +
      `'${requestedId}' was not activated by it.${openClause}`
    );
  }
  // Reachability. `targetClass` is 'unreachable' by the time the gate calls
  // this arm — 'self' is answered by the notice, 'hop' and 'open' are admitted
  // — and it is carried rather than re-derived so the sentence and the verdict
  // read the same classification.
  // Three anchors, not two: a named cursor, a cursor this caller may not be
  // told the name of, and a genuine cold start. The middle one used to print
  // the raw id — the one name the description's own law withholds.
  const from =
    cursorId !== undefined
      ? `'${cursorId}'`
      : cursorWithheld === true
      ? 'the skill the cursor stood in'
      : "the turn's start";
  // The gate reaches this arm only with `'unreachable'`; the weaker sentence is
  // for a caller that refused an admissible class for a reason of its own, and
  // it is deliberately not an invented explanation of one.
  const reason =
    targetClass === 'unreachable'
      ? `'${requestedId}' was not reachable from ${from}.`
      : `'${requestedId}' was not admitted from ${from}.`;
  // OMIT, NEVER DENY. Three cases, not two: hops to name, no hops at all, and
  // hops the graph holds that this caller may not be told about. The third used
  // to fall into the second and assert "No skill was reachable from 'alpha'"
  // while the graph routed 'alpha' to a skill the role hides — a denial of what
  // the run holds, and the one shape omission is always safe against.
  const hopClause =
    hops.named.length > 0
      ? ` Skills reachable from ${from} when that call was made: ${hops.named.join(', ')}.`
      : hops.held
      ? ''
      : ` No skill was reachable from ${from} when that call was made.`;
  return `${head}${reason}${hopClause}${openClause}`;
}
