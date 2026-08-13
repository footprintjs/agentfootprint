/**
 * routingPolicy — the decisiveness / tie policy of the turn-start routing
 * cascade (SG-C), in ONE pure module.
 *
 * The cascade's tier 2 (a classifier over declared intents, or an entry scorer
 * over descriptions) produces NUMBERS; this module turns them into a VERDICT —
 * move / stay / menu / unmatched — under declared, recorded thresholds. Scorers
 * are a tier, never a correctness dependency: a near-tie falls through to the
 * model (a menu) or to the incumbent (stay), never to a coin-flip argmax.
 *
 * **Definition of DECISIVE.** A tier-2 winner is decisive iff its raw score is
 * above the effective floor AND its TOP-2 PAIRWISE softmax share beats the
 * runner-up by at least `nearTieMargin` — softmax over just `[top, runnerUp]`
 * raw scores, i.e. `tanh((top − runnerUp) / 2)`. Pairwise on purpose: a margin
 * taken over the FULL softmax is candidate-count-dependent (ten clustered
 * candidates softmax to near-uniform shares, so a wide graph would read every
 * message as a near-tie and tier 2 would go inert). The full ranking is still
 * softmaxed for the RECORDED `relevance` shares — the numbers a person reads —
 * but the judgment is count-independent. A scorer that declares itself
 * `categorical` (the LLM classifier: one id or none) is decisive by
 * construction whenever it picked at all. Mid-conversation the incumbent is
 * scored as a candidate, so "follow-up on the current topic" and "decisively
 * new topic" are judged by the same numbers.
 *
 * Declared here / overridden where the scorer is declared (`.classify(scorer,
 * policy)` or `start.routing`) / recorded verbatim on every
 * `agentfootprint.skill.turn_routed` event — an observer never guesses which
 * thresholds judged a hop.
 *
 * NOTE on `defineRelevanceHint`: its `threshold: 0.15` compares FULL-softmax
 * relevance shares (count-sensitive), which is a different measure from the
 * pairwise margin here — the two numbers coincide but are deliberately NOT
 * re-exported from one another, because aligning a count-sensitive measure
 * with a count-independent one would be a false one-number claim.
 */

import { softmax } from './softmax.js';
import type { IntentScore } from './intentScorer.js';

/** Pairwise (top-2 softmax) gap below which tier 2 is a NEAR-TIE. */
export const NEAR_TIE_MARGIN = 0.15;

/** How many near-tied candidates the tier-3 menu offers (plus STAY). */
export const MENU_SIZE = 3;

/** The cascade's tie policy. Defaults are the exported constants above. */
export interface RoutingPolicy {
  /** Pairwise near-tie margin — see the module header for the exact measure. */
  readonly nearTieMargin: number;
  /** Cap on a NEAR-TIE menu (an `unmatched` menu offers every entry, uncapped). */
  readonly menuSize: number;
  /** Overrides the scorer's own declared floor when set. */
  readonly floor?: number;
}

/** The defaults, as one value — what an undeclared policy resolves to. */
export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  nearTieMargin: NEAR_TIE_MARGIN,
  menuSize: MENU_SIZE,
};

/** Fill a partial override against the defaults. Pure. */
export function resolveRoutingPolicy(policy?: Partial<RoutingPolicy>): RoutingPolicy {
  return {
    nearTieMargin: policy?.nearTieMargin ?? NEAR_TIE_MARGIN,
    menuSize: policy?.menuSize ?? MENU_SIZE,
    ...(policy?.floor !== undefined && { floor: policy.floor }),
  };
}

/** The traits of the scorer whose numbers are being judged — its declared
 *  floor (absent = it cannot honestly claim "did not match at all") and
 *  whether it is categorical (one id or none — a pick is decisive by
 *  construction, never diluted by the margin). */
export interface ScorerTraits {
  readonly floor?: number;
  readonly categorical?: boolean;
}

/** One ranked candidate on the record: raw score + full-softmax share. */
export interface RankedIntentScore {
  readonly id: string;
  /** The scorer's RAW output (may be non-finite — honest). */
  readonly score: number;
  /** Full-softmax share across ALL candidates, 0..1 — the recorded %. */
  readonly relevance: number;
}

/** The tier-2 verdict, with the numbers that produced it. */
export type Tier2Verdict =
  | (Tier2Numbers & { readonly kind: 'move'; readonly to: string })
  | (Tier2Numbers & { readonly kind: 'stay' })
  | (Tier2Numbers & { readonly kind: 'menu'; readonly offered: readonly string[] })
  | (Tier2Numbers & { readonly kind: 'unmatched' });

/** The recorded evidence every verdict carries. */
export interface Tier2Numbers {
  /** EVERY candidate, ranked by (sanitized) score, best first. */
  readonly ranked: readonly RankedIntentScore[];
  /** The pairwise top-vs-2nd gap that was actually judged. Absent with <2
   *  candidates above the floor. */
  readonly runnerUp?: { readonly id: string; readonly gap: number };
  /** Whether tier 2 cleared the margin + floor. */
  readonly decisive: boolean;
}

/** Pairwise top-2 softmax gap: share(a) − share(b) over just [a, b] = tanh((a−b)/2). */
function pairwiseGap(a: number, b: number): number {
  return Math.tanh((a - b) / 2);
}

/**
 * THE verdict function — pure, sync, fully unit-testable.
 *
 * Applies `rankEntries`' sanitization law (NaN/±Inf can never win), the
 * effective floor (`policy.floor ?? scorer.floor`; a score AT or BELOW it is
 * out), and the pairwise margin. See the module header for the decisive
 * definition and the verdict table in the README.
 *
 *   • decisive winner ≠ incumbent → `move`;
 *   • decisive winner = incumbent, or a near-tie WITH an incumbent → `stay`
 *     (ambiguity mid-conversation = stay; the menu is not opened);
 *   • near-tie with NO incumbent (cold start) → `menu` of the tied cluster
 *     (every candidate within the margin of the top, capped at `menuSize`);
 *   • every candidate at/below the floor → `unmatched` (the caller offers the
 *     full entry menu). Unreachable when neither the scorer nor the policy
 *     declares a floor — an embedding scorer honestly cannot claim "new
 *     topic", and the verdict table documents that.
 */
export function decideTier2(
  scores: readonly IntentScore[],
  incumbentId: string | undefined,
  policy: RoutingPolicy,
  scorer: ScorerTraits = {},
): Tier2Verdict {
  const safe = scores.map((s) => (Number.isFinite(s.score) ? s.score : Number.NEGATIVE_INFINITY));
  const relevances = softmax(safe);
  const ranked: RankedIntentScore[] = scores
    .map((s, i) => ({ id: s.id, score: s.score, relevance: relevances[i]!, safe: safe[i]! }))
    .sort((a, b) => b.safe - a.safe)
    .map(({ id, score, relevance }) => ({ id, score, relevance }));
  const safeOf = new Map(scores.map((s, i) => [s.id, safe[i]!] as const));

  const floor = policy.floor ?? scorer.floor;
  // A non-finite raw score is sanitized to -Infinity and can never be decisive:
  // it is filtered here even with no floor declared, so a lone NaN/Infinity
  // candidate reads as "unmatched", never as an uncontested winner.
  const alive = ranked.filter(
    (r) =>
      safeOf.get(r.id)! !== Number.NEGATIVE_INFINITY &&
      (floor === undefined || safeOf.get(r.id)! > floor),
  );

  if (alive.length === 0) {
    // Nothing above the floor (or nothing at all): honestly unmatched.
    return { kind: 'unmatched', ranked, decisive: false };
  }

  const top = alive[0]!;
  const second = alive[1];
  const gap = second === undefined ? 1 : pairwiseGap(safeOf.get(top.id)!, safeOf.get(second.id)!);
  const runnerUp = second !== undefined ? { id: second.id, gap } : undefined;
  const decisive =
    scorer.categorical === true || second === undefined || gap >= policy.nearTieMargin;
  const numbers: Tier2Numbers = { ranked, ...(runnerUp && { runnerUp }), decisive };

  if (decisive) {
    if (incumbentId !== undefined && top.id === incumbentId) return { kind: 'stay', ...numbers };
    return { kind: 'move', to: top.id, ...numbers };
  }
  // Near-tie. Mid-conversation the incumbent holds (ambiguity = stay);
  // cold start opens the menu of the tied cluster.
  if (incumbentId !== undefined) return { kind: 'stay', ...numbers };
  const tied = alive
    .filter((r) => pairwiseGap(safeOf.get(top.id)!, safeOf.get(r.id)!) < policy.nearTieMargin)
    .slice(0, Math.max(2, policy.menuSize))
    .map((r) => r.id);
  return { kind: 'menu', offered: tied, ...numbers };
}

/**
 * The turn-start verdict as the LOOP may act on it — a scope-safe POJO twin of
 * the `skill.turn_routed` payload, stamped by the RouteTurn stage and threaded
 * into `InjectionContext.turnRoute` by the mount mappers. The cursor resolver
 * consumes `to` on iteration 1; the tier-3 envelope (the `read_skill` menu
 * section + the menu hint) reads `offered`.
 *
 * Under `strictness: 'rails'` a menu verdict is stamped WITHOUT `offered`:
 * the model is not allowed to act on it, so nothing downstream may offer it —
 * the full verdict (offered included) still rides the `turn_routed` EVENT,
 * because what happened and what the loop may act on are different facts.
 */
export interface TurnRoute {
  /** The tier that decided the turn's start. `'entry'` = a tier-1 rule;
   *  `'intent'` = the tier-2 scorer was decisive; `'continuity'` = the
   *  inherited cursor held; `'menu'` = a menu is outstanding; `'none'` = the
   *  cascade decided nothing this turn (rails menu, or a dropped resume). */
  readonly by: 'entry' | 'intent' | 'continuity' | 'menu' | 'none';
  /** The inherited cursor (continuity), when one existed. */
  readonly from?: string;
  /** Where the turn starts. Absent = menu pending / none. */
  readonly to?: string;
  /** The tier-3 menu, while one is actionable. */
  readonly offered?: readonly string[];
  /** STAY was a first-class option in that menu (mid-conversation). */
  readonly stayOffered?: boolean;
  /** Advisory relevance shares for the envelope (full-softmax, 0..1). */
  readonly relevance?: ReadonlyArray<{ readonly id: string; readonly relevance: number }>;
}

/**
 * Is the turn's menu still OUTSTANDING — offered, and not yet resolved by an
 * accepted pick? True while the cursor is still where the verdict left it
 * (`undefined` on a cold menu; the inherited `from` on a mid-conversation
 * one). The ONE implementation shared by the envelope (tools slot), the
 * `cursorMove` decoration (Evaluate) and the `'guard'` gate — the three may
 * never disagree about whether the model was still being offered a menu.
 */
export function menuOutstanding(
  turnRoute: TurnRoute | undefined,
  currentSkillId: string | undefined,
): boolean {
  if (turnRoute?.offered === undefined) return false;
  return currentSkillId === undefined || currentSkillId === turnRoute.from;
}
